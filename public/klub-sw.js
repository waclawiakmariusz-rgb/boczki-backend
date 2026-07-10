// klub-sw.js — service worker apki Klub (dodatek lojalnosc).
// Instalowalność PWA (network-first, bez cache offline — saldo musi być świeże)
// + odbiór Web Push (Faza 4): payload JSON {title, body, url}.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* passthrough — wymagany handler dla instalowalności */ });

self.addEventListener('push', (event) => {
  let dane = { title: '💎 Klub', body: 'Masz nową wiadomość od salonu.', url: '/klub.html' };
  try { dane = Object.assign(dane, event.data.json()); } catch (e) { /* payload nie-JSON → domyślne */ }
  event.waitUntil(
    self.registration.showNotification(dane.title, {
      body: dane.body,
      icon: '/klub-icon.svg',
      badge: '/klub-icon.svg',
      vibrate: [200, 100, 200],
      data: { url: dane.url || '/klub.html' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/klub.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
      for (const c of lista) {
        if (c.url.includes('/klub') && 'focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
