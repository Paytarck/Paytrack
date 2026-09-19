// app-promo.js
// ---------------------------------------------------------------------
// Promotes the real Android app when PayTrack is opened as a plain
// website instead of the installed Capacitor app. Two pieces, both
// skipped entirely inside the real app:
//
//   1. A dismissible "Get the PayTrack app" card, shown the first time
//      someone opens the site (and again after a snooze period if they
//      dismiss it).
//   2. A small "Get App" pill that stays on screen the whole time the
//      site is used in a browser — this is the "always present" button.
//
// Detection: window.Capacitor.isNativePlatform() is Capacitor's own,
// official way to tell a real native build apart from the same code
// running in a plain browser (even one that happens to have capacitor.js
// present) — see https://capacitorjs.com/docs/core-apis/web
//
// IMPORTANT — before shipping: set APP_DOWNLOAD_URL below to your real
// Play Store listing (preferred) or a directly-hosted .apk download link.
// Until you have one, this script won't inject anything broken, but the
// button will link nowhere useful — see the console warning below.
(function () {
    const APP_DOWNLOAD_URL = 'https://github.com/Paytarck/paytrack-app/releases/latest/download/app-debug.apk';

    // If someone collapses the bigger card, don't show it again for this long
    // (the compact "Get App" pill stays on screen the whole time regardless).
    const COLLAPSE_KEY = 'paytrackInstallCardCollapsedAt';
    const RE_EXPAND_AFTER_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

    function isNativeApp() {
        return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    }

    function openDownload() {
        if (APP_DOWNLOAD_URL.indexOf('REPLACE_WITH_YOUR') === 0) {
            console.warn('app-promo.js: set APP_DOWNLOAD_URL to your real Play Store or APK link.');
        }
        window.open(APP_DOWNLOAD_URL, '_blank', 'noopener');
    }

    function injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
        #ptInstallWidget {
            position: fixed;
            right: 16px;
            bottom: calc(16px + env(safe-area-inset-bottom, 0px));
            z-index: 9998;
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            gap: 10px;
            font-family: 'Inter', 'Outfit', -apple-system, BlinkMacSystemFont, sans-serif;
        }
        #ptInstallWidget .pt-card {
            display: none;
            align-items: center;
            gap: 10px;
            max-width: 280px;
            background: #fff;
            color: #1a202c;
            border-radius: 16px;
            padding: 12px 12px 12px 10px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.18);
            animation: ptPopIn 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }
        #ptInstallWidget.pt-expanded .pt-card { display: flex; }
        @keyframes ptPopIn { from { opacity: 0; transform: translateY(8px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
        #ptInstallWidget .pt-card img {
            width: 36px; height: 36px; border-radius: 10px; flex-shrink: 0;
            box-shadow: 0 2px 6px rgba(0,0,0,0.15);
        }
        #ptInstallWidget .pt-card-text { flex: 1; line-height: 1.25; }
        #ptInstallWidget .pt-card-text strong { display: block; font-size: 0.85rem; }
        #ptInstallWidget .pt-card-text span { display: block; font-size: 0.72rem; color: #718096; margin-top: 2px; }
        #ptInstallWidget .pt-card-actions { display: flex; flex-direction: column; gap: 4px; align-items: stretch; }
        #ptInstallWidget .pt-install-btn {
            border: none; cursor: pointer; border-radius: 8px; font-weight: 700; font-size: 0.75rem;
            padding: 6px 10px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #fff;
        }
        #ptInstallWidget .pt-collapse-btn {
            border: none; cursor: pointer; background: transparent; color: #a0aec0; font-size: 0.68rem; text-decoration: underline;
        }
        #ptInstallWidget .pt-pill-btn {
            display: flex; align-items: center; gap: 8px;
            border: none; cursor: pointer; border-radius: 999px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #fff;
            font-weight: 700; font-size: 0.82rem; padding: 12px 18px;
            box-shadow: 0 8px 20px rgba(102, 126, 234, 0.4);
        }
        #ptInstallWidget .pt-pill-btn i { font-size: 0.95rem; }
        @media (min-width: 768px) {
            #ptInstallWidget { right: 24px; bottom: 24px; }
        }
        `;
        document.head.appendChild(style);
    }

    function buildWidget() {
        const collapsedAt = parseInt(localStorage.getItem(COLLAPSE_KEY) || '0', 10);
        const startExpanded = !(collapsedAt && (Date.now() - collapsedAt) < RE_EXPAND_AFTER_MS);

        const wrap = document.createElement('div');
        wrap.id = 'ptInstallWidget';
        if (startExpanded) wrap.classList.add('pt-expanded');

        wrap.innerHTML = `
            <div class="pt-card">
                <img src="Paytrack-icon.png" alt="PayTrack" onerror="this.style.display='none'">
                <div class="pt-card-text">
                    <strong>Get the PayTrack app</strong>
                    <span>Faster, works fully offline, and unlocks fingerprint login.</span>
                </div>
                <div class="pt-card-actions">
                    <button type="button" class="pt-install-btn">Install</button>
                    <button type="button" class="pt-collapse-btn">Not now</button>
                </div>
            </div>
            <button type="button" class="pt-pill-btn" aria-label="Get the PayTrack app">
                <i class="fas fa-download"></i><span>Get App</span>
            </button>
        `;
        document.body.appendChild(wrap);

        wrap.querySelector('.pt-install-btn').addEventListener('click', openDownload);
        wrap.querySelector('.pt-pill-btn').addEventListener('click', openDownload);
        wrap.querySelector('.pt-collapse-btn').addEventListener('click', () => {
            localStorage.setItem(COLLAPSE_KEY, String(Date.now()));
            wrap.classList.remove('pt-expanded');
        });
    }

    function init() {
        if (isNativeApp()) return; // already the real app — nothing to promote
        if (document.getElementById('ptInstallWidget')) return; // already injected
        injectStyles();
        buildWidget();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
