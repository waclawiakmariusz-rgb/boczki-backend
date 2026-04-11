require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();

app.use(cors());

// Stripe webhook musi dostać raw body — PRZED express.json()
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

// Pozostałe endpointy — JSON
app.use(express.json());

// Serwowanie plików statycznych (index.html, etc.)
app.use(express.static('public'));

// Usuwa apostrofy/cudzysłowy które Hostinger panel dodaje do wartości env
function env(key) {
    return (process.env[key] || '').replace(/^['"]|['"]$/g, '');
}

// Konfiguracja puli połączeń z bazą MySQL
const db = mysql.createPool({
    host: env('DB_HOST'),
    user: env('DB_USER'),
    password: env('DB_PASSWORD'),
    database: env('DB_NAME'),
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    dateStrings: true,
    enableKeepAlive: true,
    keepAliveInitialDelay: 30000
});

db.getConnection((err, connection) => {
    if (err) {
        console.error('Błąd połączenia z bazą danych:', err.message);
    } else {
        console.log('SUKCES! Połączono z bazą danych MySQL!');
        connection.release();
    }
});

// ==========================================
// IMPORTY ROUTERÓW
// ==========================================
const authRoutes       = require('./routes/auth')(db);
const magazynRoutes    = require('./routes/magazyn')(db);
const sprzedazRoutes   = require('./routes/sprzedaz')(db);
const klienciRoutes    = require('./routes/klienci')(db);
const rodoRoutes       = require('./routes/rodo')(db);
const urodzinyRoutes   = require('./routes/urodziny')(db);
const retencjaRoutes   = require('./routes/retencja')(db);
const analitykaRoutes  = require('./routes/analityka')(db);
const konsultacjeRoutes = require('./routes/konsultacje')(db);
const targetyRoutes    = require('./routes/targety')(db);
const raportRoutes     = require('./routes/raport')(db);
const usersRoutes      = require('./routes/users')(db);
const logiRoutes       = require('./routes/logi')(db);
const adminRoutes      = require('./routes/admin')(db);
const stripeRoutes     = require('./routes/stripe')(db);

// ==========================================
// REJESTRACJA ROUTERÓW
// ==========================================
app.use('/api', authRoutes);
app.use('/api', magazynRoutes);
app.use('/api', sprzedazRoutes);
app.use('/api', klienciRoutes);
app.use('/api', rodoRoutes);
app.use('/api', urodzinyRoutes);
app.use('/api', retencjaRoutes);
app.use('/api', analitykaRoutes);
app.use('/api', konsultacjeRoutes);
app.use('/api', targetyRoutes);
app.use('/api', raportRoutes);
app.use('/api', usersRoutes);
app.use('/api', logiRoutes);
app.use('/api', adminRoutes);
app.use('/api', stripeRoutes);

// ==========================================
// TEST ENDPOINT
// ==========================================
app.get('/test', (req, res) => {
    res.json({ message: 'Serwer Boczki API działa w 100%!' });
});

app.get('/dbstatus', (req, res) => {
    const tabele = ['Licencje', 'Zamowienia', 'Kody_rabatowe', 'Tokeny_rejestracji'];
    const wyniki = {};
    let pozostalo = tabele.length;

    tabele.forEach(t => {
        db.query(`SELECT COUNT(*) AS n FROM \`${t}\``, (err, rows) => {
            wyniki[t] = err ? 'BŁĄD: ' + err.message : rows[0].n + ' rekordów';
            if (--pozostalo === 0) {
                res.json({
                    db_host: process.env.DB_HOST,
                    db_name: process.env.DB_NAME,
                    tabele: wyniki
                });
            }
        });
    });
});

// ==========================================
// ENDPOINT GŁÓWNY - ROUTER KOMPATYBILNOŚCI
// Obsługa starych klientów wysyłających ?action=...
// ==========================================
app.get('/api', (req, res) => {
    const action = req.query.action;
    const tenant_id = req.query.tenant_id;

    if (!action) return res.send('SaaS Master Engine działa poprawnie (Status: OK).');
    if (!tenant_id) return res.json({ status: 'error', message: 'Błąd sesji SaaS: Brak autoryzacji (tenant_id).' });

    // Przekierowanie do właściwych endpointów poprzez wewnętrzne wywołanie
    const getActions = {
        'read': '/api/magazyn?action=read&tenant_id=' + tenant_id,
        'archive_read': '/api/magazyn?action=archive_read&tenant_id=' + tenant_id,
        'dictionary': '/api/magazyn?action=dictionary&tenant_id=' + tenant_id,
        'birthdays': '/api/urodziny?action=birthdays&tenant_id=' + tenant_id + (req.query.miesiac ? '&miesiac=' + req.query.miesiac : ''),
        'upcoming_birthdays': '/api/urodziny?action=upcoming_birthdays&tenant_id=' + tenant_id,
        'get_client_birthday': '/api/urodziny?action=get_client_birthday&tenant_id=' + tenant_id + '&klient=' + encodeURIComponent(req.query.klient || ''),
        'sales_history': '/api/sprzedaz?action=sales_history&tenant_id=' + tenant_id,
        'full_sales_history': '/api/sprzedaz?action=full_sales_history&tenant_id=' + tenant_id,
        'sales_dictionary': '/api/sprzedaz?action=sales_dictionary&tenant_id=' + tenant_id,
        'get_discounts': '/api/sprzedaz?action=get_discounts&tenant_id=' + tenant_id,
        'emergency_history': '/api/sprzedaz?action=emergency_history&tenant_id=' + tenant_id,
        'get_system_logs': '/api/get_system_logs?tenant_id=' + tenant_id,
        'get_clients': '/api/klienci?action=get_clients&tenant_id=' + tenant_id,
        'get_client_profile_data': '/api/klienci?action=get_client_profile_data&tenant_id=' + tenant_id + '&klient=' + encodeURIComponent(req.query.klient || ''),
        'get_wallet': '/api/klienci?action=get_wallet&tenant_id=' + tenant_id + '&klient=' + encodeURIComponent(req.query.klient || ''),
        'get_all_deposits': '/api/klienci?action=get_all_deposits&tenant_id=' + tenant_id,
        'get_client_memo': '/api/klienci?action=get_client_memo&tenant_id=' + tenant_id + '&klient=' + encodeURIComponent(req.query.klient || ''),
        'get_suggestion_rules': '/api/klienci?action=get_suggestion_rules&tenant_id=' + tenant_id,
        'get_consents': '/api/rodo?action=get_consents&tenant_id=' + tenant_id + '&id=' + (req.query.id || ''),
        'get_rodo': '/api/rodo?action=get_rodo&tenant_id=' + tenant_id + '&id=' + (req.query.id || ''),
        'get_all_rodo': '/api/rodo?action=get_all_rodo&tenant_id=' + tenant_id,
        'get_retention': '/api/retencja?tenant_id=' + tenant_id,
        'get_months': '/api/analityka?action=get_months&tenant_id=' + tenant_id,
        'an_get_months': '/api/analityka?action=get_months&tenant_id=' + tenant_id,
        'get_daily_summary': '/api/analityka?action=get_daily_summary&tenant_id=' + tenant_id + '&date=' + (req.query.date || ''),
        'an_get_daily_summary': '/api/analityka?action=get_daily_summary&tenant_id=' + tenant_id + '&date=' + (req.query.date || ''),
        'get_costs_list': '/api/analityka?action=get_costs_list&tenant_id=' + tenant_id,
        'an_get_costs_list': '/api/analityka?action=get_costs_list&tenant_id=' + tenant_id,
        'kon_read_results': '/api/konsultacje?action=kon_read_results&tenant_id=' + tenant_id,
        'kon_get_consultants': '/api/konsultacje?action=kon_get_consultants&tenant_id=' + tenant_id + '&onlyActive=' + (req.query.onlyActive || ''),
        'kon_get_logs': '/api/konsultacje?action=kon_get_logs&tenant_id=' + tenant_id,
        'kon_get_campaigns': '/api/konsultacje?action=kon_get_campaigns&tenant_id=' + tenant_id,
        'akon_get_months': '/api/konsultacje?action=akon_get_months&tenant_id=' + tenant_id,
        'get_pin_users': '/api/users?action=get_pin_users&tenant_id=' + tenant_id,
        'get_admin_users': '/api/users?action=get_admin_users&tenant_id=' + tenant_id,
    };

    if (getActions[action]) {
        return res.redirect(getActions[action]);
    }

    return res.json({ status: 'error', message: 'Błąd: Nieznana akcja GET: ' + action });
});

// ==========================================
// POST /api - ROUTER KOMPATYBILNOŚCI
// Obsługa starych klientów wysyłających JSON z action
// ==========================================
app.post('/api', (req, res) => {
    const d = req.body || {};
    const action = d.action;

    if (!action) return res.json({ status: 'error', message: 'Brak akcji' });

    // Login nie wymaga tenant_id
    if (action === 'login') {
        req.url = '/login';
        return authRoutes(req, res, () => res.json({ status: 'error', message: 'Nieznana akcja auth' }));
    }

    const tenant_id = d.tenant_id;
    if (!tenant_id) return res.json({ status: 'error', message: 'Błąd sesji SaaS: Brak przypisanej bazy. Zaloguj się ponownie.' });

    // Mapowanie akcji na route handlery
    const magazynActions = ['update', 'add', 'add_model', 'delete', 'restore', 'edit_product', 'edit_dictionary_entry', 'delete_dictionary_entry'];
    const sprzedazActions = ['add_sale', 'edit_sale', 'delete_sale', 'add_sales_def', 'add_multi_sale', 'emergency_edit_sale', 'add_discount_def', 'delete_employee', 'delete_service', 'edit_service'];
    const klienciActions = ['add_client', 'add_client_fast_sales', 'edit_client_data', 'save_client_memo', 'manage_deposit', 'merge_deposits', 'add_suggestion_rule', 'delete_suggestion_rule'];
    const rodoActions = ['save_rodo', 'update_consents'];
    const urodzinyActions = ['add_birthday', 'update_birthday_status', 'update_birthday_comment', 'update_birthday_field'];
    const retencjaActions = ['save_retention'];
    const analitykaActions = ['get_months', 'an_get_months', 'get_daily_summary', 'an_get_daily_summary', 'get_monthly_details', 'an_get_monthly_details', 'save_monthly_cost', 'an_save_monthly_cost', 'get_costs_list', 'an_get_costs_list', 'get_stats', 'an_get_stats', 'get_yearly_summary', 'an_get_yearly_summary', 'get_treatment_analysis', 'an_get_treatment_analysis', 'get_bi_data', 'an_get_bi_data'];
    const konsultacjeActions = ['kon_save_result', 'kon_update_result', 'kon_add_consultant', 'kon_delete_consultant', 'kon_save_campaign', 'kon_toggle_campaign', 'akon_get_months', 'akon_get_stats', 'akon_get_daily_summary', 'akon_get_monthly_details', 'akon_get_monthly_list', 'akon_get_consultants', 'odp_getReportData'];
    const targetyActions = ['add_target', 'get_targets', 'edit_target', 'tgt_get_employee_dashboard'];
    const raportActions = ['rap_getInventory', 'rap_getCategories', 'rap_getLogs', 'rap_updateStock', 'rap_archiveProduct', 'rap_saveProduct', 'rap_saveCategory', 'rap_deleteCategory'];
    const usersActions = ['verify_pin', 'get_pin_users', 'get_admin_users', 'add_admin_user', 'delete_admin_user'];

    if (magazynActions.includes(action)) {
        req.url = '/magazyn';
        return magazynRoutes(req, res, () => {});
    } else if (sprzedazActions.includes(action)) {
        req.url = '/sprzedaz';
        return sprzedazRoutes(req, res, () => {});
    } else if (klienciActions.includes(action)) {
        req.url = '/klienci';
        return klienciRoutes(req, res, () => {});
    } else if (rodoActions.includes(action)) {
        req.url = '/rodo';
        return rodoRoutes(req, res, () => {});
    } else if (urodzinyActions.includes(action)) {
        req.url = '/urodziny';
        return urodzinyRoutes(req, res, () => {});
    } else if (retencjaActions.includes(action)) {
        req.url = '/retencja';
        return retencjaRoutes(req, res, () => {});
    } else if (analitykaActions.includes(action)) {
        req.url = '/analityka';
        return analitykaRoutes(req, res, () => {});
    } else if (konsultacjeActions.includes(action)) {
        req.url = '/konsultacje';
        return konsultacjeRoutes(req, res, () => {});
    } else if (targetyActions.includes(action)) {
        req.url = '/targety';
        return targetyRoutes(req, res, () => {});
    } else if (raportActions.includes(action)) {
        req.url = '/raport';
        return raportRoutes(req, res, () => {});
    } else if (usersActions.includes(action)) {
        req.url = '/users';
        return usersRoutes(req, res, () => {});
    }

    return res.json({ status: 'error', message: 'Nieznana akcja POST: ' + action });
});

// ==========================================
// URUCHOMIENIE SERWERA
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Serwer nasłuchuje na porcie: ${PORT}`);
    console.log(`Otwórz w przeglądarce: http://localhost:${PORT}/test`);
});
