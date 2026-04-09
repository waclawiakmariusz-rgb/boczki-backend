require('dotenv').config();
const fs = require('fs');
const mysql = require('mysql2/promise');
const csv = require('csv-parser');
const crypto = require('crypto');

const TENANT_ID = 'boczki-salon-glowny-001'; 

async function startMigration() {
    try {
        const db = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        });

        console.log('✅ Połączono z bazą. Rozpoczynam czytanie pliku Ustawienia.csv...');

        const results = [];
        
        fs.createReadStream('Ustawienia.csv')
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', async () => {
                console.log(`Znalazłem ${results.length} wierszy. Wrzucam do bazy!`);

                for (const row of results) {
                    const id = crypto.randomUUID();
                    const keys = Object.keys(row);
                    const login = row[keys[0]];
                    const haslo = row[keys[1]];
                    const rola = row[keys[2]];

                    await db.execute(
                        'INSERT INTO `Ustawienia` (id, tenant_id, login, haslo, rola) VALUES (?, ?, ?, ?, ?)',
                        [id, TENANT_ID, login, haslo, rola]
                    );
                }

                console.log('🎉 SUKCES! Plik Ustawienia.csv został wgrany do bazy!');
                process.exit();
            });

    } catch (error) {
        console.error('❌ Ups, coś poszło nie tak:', error);
    }
}

startMigration();