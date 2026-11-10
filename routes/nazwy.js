// routes/nazwy.js — jedna reguła pisowni nazw, które są KLUCZAMI między tabelami (imię pracownika,
// kategoria i wariant usługi). Powód (audyt terminarza 10.11.2026): salon dopisał osobę „Aleksandra Cabaj ”
// ze spacją na końcu; formularz obcinał spację, lista z bazy nie → „Nieznany pracownik”. W cenniku
// 22 usługi ze spacjami na końcu dawały podwójne kategorie („Omega” i „Omega ”).
//
// Reguła (uzgodniona z właścicielem 10.11): spacja MIĘDZY imieniem a nazwiskiem zostaje, spacje na
// początku i na końcu są obcinane, a przypadkowe wielokrotne spacje w środku zwijane do jednej.

/** „  Anna   Kowalska  ” → „Anna Kowalska”; null/undefined → „”. */
function normalizujNazwe(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

/** Porównanie nazw bez wrażliwości na spacje końcowe i wielkość liter (do wykrywania dubli). */
function taSamaNazwa(a, b) {
  return normalizujNazwe(a).toLowerCase() === normalizujNazwe(b).toLowerCase();
}

/** Czy nazwa po normalizacji jest w liście (lista też normalizowana). */
function nazwaNaLiscie(nazwa, lista) {
  const n = normalizujNazwe(nazwa);
  return (Array.isArray(lista) ? lista : []).some(x => normalizujNazwe(x) === n);
}

module.exports = { normalizujNazwe, taSamaNazwa, nazwaNaLiscie };
