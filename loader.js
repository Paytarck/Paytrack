// loader.js — Global "action in progress" loading overlay.
// Include this on every page BEFORE your page's own script.
// Usage:
//   showLoading('Opening project...');   // show it
//   hideLoading();                       // hide it when the action is done
//
// It also auto-triggers itself on common "do the thing" buttons (see
// AUTO_SELECTOR below) so most existing buttons get a spinner for free.
// Add data-loading="Custom message" to any button to customize the text,
// or data-no-loading to opt a button out entirely.

(function () {
    const MIN_VISIBLE_MS = 250;    // avoid a 1-frame flicker on instant actions
    const SAFETY_TIMEOUT_MS = 15000; // auto-hide if a handler forgets to call hideLoading()
    const AUTO_SELECTOR = [
        '.btn-primary', '.btn-danger', '.open-project-btn',
        '.back-button', '.settings-back-home-btn',
        '[data-loading]'
    ].join(', ');

    let overlay = null;
    let textEl = null;
    let shownAt = 0;
    let safetyTimer = null;
    let hideTimer = null;

    function ensureOverlay() {
        if (overlay) return;

        const style = document.createElement('style');
        style.textContent = `
            @keyframes galSpin { to { transform: rotate(360deg); } }
            #globalActionLoader {
                position: fixed; inset: 0; z-index: 99999;
                display: none; align-items: center; justify-content: center;
                flex-direction: column; gap: 16px;
                background: rgba(15, 15, 20, 0.6);
                backdrop-filter: blur(4px);
                -webkit-backdrop-filter: blur(4px);
                opacity: 0;
                transition: opacity 0.2s ease;
            }
            #globalActionLoader.show { display: flex; opacity: 1; }
            #globalActionLoader .gal-spinner {
                width: 54px; height: 54px; border-radius: 50%;
                border: 4px solid rgba(255,255,255,0.25);
                border-top-color: #3b82f6;
                animation: galSpin 0.7s linear infinite;
            }
            #globalActionLoader .gal-text {
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 0.95rem; font-weight: 600;
                color: #f3f4f6; letter-spacing: 0.01em;
                text-align: center; padding: 0 24px;
            }
        `;
        document.head.appendChild(style);

        overlay = document.createElement('div');
        overlay.id = 'globalActionLoader';
        overlay.innerHTML = `
            <div class="gal-spinner"></div>
            <p class="gal-text" id="globalActionLoaderText">Loading...</p>
        `;
        document.body.appendChild(overlay);
        textEl = overlay.querySelector('#globalActionLoaderText');
    }

    function showLoading(message) {
        ensureOverlay();
        clearTimeout(hideTimer);
        clearTimeout(safetyTimer);
        textEl.textContent = message || 'Loading...';
        overlay.classList.add('show');
        shownAt = Date.now();
        // Safety net: never let the overlay get stuck forever.
        safetyTimer = setTimeout(hideLoading, SAFETY_TIMEOUT_MS);
    }

    function hideLoading() {
        if (!overlay) return;
        clearTimeout(safetyTimer);
        const elapsed = Date.now() - shownAt;
        const wait = Math.max(0, MIN_VISIBLE_MS - elapsed);
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => overlay && overlay.classList.remove('show'), wait);
    }

    window.showLoading = showLoading;
    window.hideLoading = hideLoading;

    // Auto-wire common action buttons app-wide.
    document.addEventListener('click', function (e) {
        const el = e.target.closest(AUTO_SELECTOR);
        if (!el || el.disabled || el.hasAttribute('data-no-loading')) return;
        showLoading(el.getAttribute('data-loading') || undefined);
    }, true);

    // Safety: if a page navigation happens, the overlay just disappears with
    // the old page. If the user gets bounced back (bfcache), make sure it's hidden.
    window.addEventListener('pageshow', () => hideLoading());
})();