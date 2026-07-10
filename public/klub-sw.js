// klub-sw.js — service worker apki Klub (dodatek lojalnosc).
// Faza 2: minimalny SW dla instalowalności PWA (network-first, bez cache offline —
// saldo punktów musi być zawsze świeże). Web Push dojdzie w Fazie 4.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* passthrough — wymagany handler dla instalowalności */ });
