// Registers the service worker that makes the app (styling, fonts, icons,
// vendor libraries, and the app's own code) fully available offline after
// the first successful online visit. If registration fails or the browser
// doesn't support service workers, the app still works — it just won't
// have offline caching, which is exactly today's behavior.
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch((err) => {
            console.log('Service worker registration failed (offline caching disabled):', err);
        });
    });
}