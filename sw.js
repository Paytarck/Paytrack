/*
 * PayTrack service worker
 * ------------------------------------------------------------------
 * Goal: once the app has been opened online at least once, it should
 * look and behave IDENTICALLY offline — same fonts, same Tailwind
 * styling, same icons, same charts library, same app code. Without
 * this file, things like the Tailwind CDN script or Google Fonts
 * simply fail to download when offline, which is what makes the UI
 * "fall apart" (unstyled boxes, missing icons, broken layout).
 *
 * Strategy:
 *  - App shell (this site's own html/css/js/images): "network-first,
 *    falling back to cache". Online, you always get the latest code;
 *    offline, you get the last version that loaded successfully.
 *  - Vendor libraries (Tailwind, Font Awesome, Google Fonts, Chart.js,
 *    xlsx, html2canvas, tesseract.js, the Firebase SDK itself): 
 *    "cache-first". These are static library files that rarely change,
 *    so serving the cached copy instantly is both faster and safer.
 *  - Live cloud calls (Firestore, Firebase Auth, etc.): NEVER cached,
 *    NEVER intercepted. They must always hit the real network so data
 *    is never stale or wrong; when offline they simply fail, and the
 *    app's own code already treats that as "we're offline" and keeps
 *    working from localStorage.
 */

const CACHE_VERSION = 'paytrack-v1';
const APP_SHELL_CACHE = `${CACHE_VERSION}-shell`;
const VENDOR_CACHE = `${CACHE_VERSION}-vendor`;

// Local files that make up the app itself. Fetched best-effort — if one of
// these doesn't actually exist on the server, it's simply skipped rather
// than failing the whole install (so this list can be a superset).
const APP_SHELL_URLS = [
    './',
    'index.html',
    'splash.css',
    'splash.jpeg',
    'capacitor.js',
    'dashboard.html',
    'dashboard.js',
    'dashboard.css',
    'paytrack.html',
    'paytrack.js',
    'paytrack.css',
    'settings.html',
    'settings.js',
    'settings.css',
    'lock.html',
    'lock.js',
    'lock.css',
    'auth.js',
    'firebase-config.js',
    'loader.js',
    'translations.js',
    'theme-utils.js',
    'net-status.js',
    'sw-register.js',
    'app-promo.js',
    'Paytrack-icon.png',
];

// Third-party assets every page depends on for its actual look (Tailwind's
// utility classes, Font Awesome icons, the Inter webfont, and the "no
// projects" illustration). These are fetched and cached right away during
// install instead of waiting for each page's first real visit, so a device
// that goes offline shortly after installing the app still renders styled
// and complete rather than as unstyled boxes with missing icons.
const VENDOR_PRECACHE_URLS = [
    'https://cdn.tailwindcss.com',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;800&display=swap', // index.html's splash screen requests a different weight set than the rest of the app
    'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap',
    'https://storage.googleapis.com/a1aa/image/4363df2d-cd71-4acb-a7e5-6dadbffa8043.jpg',
    // paytrack.html's feature libraries — precached eagerly (not just cache-first-after-use)
    // so exporting, charting, screenshotting and scanning a receipt all work correctly even
    // the very first time paytrack.html is opened, including on a device that's never been
    // online before reaching this page.
    'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
    'https://cdn.jsdelivr.net/npm/chart.js',
    'https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0',
    'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
    'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
];

// Hosts whose files are safe to cache-first (static, versioned vendor libs).
const VENDOR_HOSTS = [
    'cdn.tailwindcss.com',
    'cdnjs.cloudflare.com',
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'cdn.jsdelivr.net',
    'www.gstatic.com',
    'storage.googleapis.com',
    // Tesseract.js's default langPath — its OCR worker fetches the actual English
    // language data from here at runtime (a separate host from the script itself).
    // Not eagerly precached above because the file is large; it's cached the first
    // time a receipt scan succeeds online, and works offline from then on.
    'tessdata.projectnaptha.com',
];

// Hosts that must ALWAYS go straight to the network — live data/auth calls
// that should never be served from (or written to) a cache.
const NEVER_CACHE_HOSTS = [
    'firestore.googleapis.com',
    'identitytoolkit.googleapis.com',
    'securetoken.googleapis.com',
    'firebaseio.com',
    'firebaseinstallations.googleapis.com',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        (async () => {
            const shellCache = await caches.open(APP_SHELL_CACHE);
            const vendorCache = await caches.open(VENDOR_CACHE);
            await Promise.allSettled([
                ...APP_SHELL_URLS.map((url) =>
                    fetch(url, { cache: 'no-cache' })
                        .then((res) => {
                            if (res && res.ok) return shellCache.put(url, res);
                        })
                        .catch(() => {})
                ),
                // 'no-cors' because these are cross-origin: we can't read the
                // response, but the browser can still cache and later replay
                // the opaque response for a <script>/<link> tag, which is all
                // that's actually needed here.
                ...VENDOR_PRECACHE_URLS.map((url) =>
                    fetch(url, { mode: 'no-cors' })
                        .then((res) => {
                            if (res) return vendorCache.put(url, res);
                        })
                        .catch(() => {})
                ),
            ]);
            self.skipWaiting();
        })()
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        (async () => {
            const keys = await caches.keys();
            await Promise.all(
                keys
                    .filter((key) => key.startsWith('paytrack-') && key !== APP_SHELL_CACHE && key !== VENDOR_CACHE)
                    .map((key) => caches.delete(key))
            );
            await self.clients.claim();
        })()
    );
});

function isNeverCache(url) {
    return NEVER_CACHE_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith('.' + host));
}

function isVendor(url) {
    return VENDOR_HOSTS.includes(url.hostname);
}

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return; // never intercept writes/posts

    const url = new URL(request.url);

    // Live Firebase/cloud traffic: hands off entirely, let it hit the
    // network (or fail naturally offline) exactly as if there were no
    // service worker at all.
    if (isNeverCache(url)) return;

    // Vendor libraries: cache-first for instant, reliable offline loading.
    if (isVendor(url)) {
        event.respondWith(
            (async () => {
                const cache = await caches.open(VENDOR_CACHE);
                const cached = await cache.match(request);
                if (cached) return cached;
                try {
                    const fresh = await fetch(request);
                    if (fresh && fresh.ok) cache.put(request, fresh.clone());
                    return fresh;
                } catch (e) {
                    return cached || Response.error();
                }
            })()
        );
        return;
    }

    // Same-origin app shell: network-first (so people online always get the
    // latest version), falling back to whatever was last cached (so the app
    // still opens, styled and functional, with zero connectivity).
    if (url.origin === self.location.origin) {
        event.respondWith(
            (async () => {
                const cache = await caches.open(APP_SHELL_CACHE);
                try {
                    const fresh = await fetch(request);
                    if (fresh && fresh.ok) cache.put(request, fresh.clone());
                    return fresh;
                } catch (e) {
                    const cached = await cache.match(request);
                    return cached || Response.error();
                }
            })()
        );
    }
});

// --- BACKGROUND SYNC -------------------------------------------------
// The page (dashboard.js / settings.js) registers this tag every time it
// saves something locally. The browser then fires 'sync' here as soon as
// connectivity is back — even if the PayTrack tab isn't the active tab —
// without waiting for the user to reopen or refresh the app.
//
// The service worker itself has no access to localStorage (only pages do),
// so it can't push the data to Firestore directly. Instead it asks any
// PayTrack tab that's still open in the browser to run its normal
// triggerCloudSync()/syncDataToCloud() flow, which already has everything
// it needs (localStorage + the Firebase SDK). If no tab is open at all,
// there is nothing this file can do about it: standard Background Sync
// only wakes the service worker while the browser process itself is still
// running, not after the app/browser has been fully closed or the device
// rebooted. Syncing while the app is completely closed would require a
// native background task (e.g. a Capacitor background-fetch plugin), not
// something achievable from web JS alone.
self.addEventListener('sync', (event) => {
    if (event.tag !== 'paytrack-sync') return;
    event.waitUntil(
        (async () => {
            const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
            clientsList.forEach((client) => client.postMessage({ type: 'PAYTRACK_FLUSH_SYNC' }));
        })()
    );
});