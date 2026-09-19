// net-status.js
// ---------------------------------------------------------------------
// One small, dependency-free script shared by dashboard.html, paytrack.html
// (and lock.html) that:
//   1. Tracks whether the browser currently has connectivity.
//   2. Drives a consistent "#cloudStatus" pill (Online / Offline / Syncing /
//      Sync failed) so the UI always tells the truth about connection state
//      instead of silently breaking or looking broken.
//   3. Exposes window.PayTrackNet so dashboard.js / paytrack.js can react to
//      reconnect events and push status updates through the same pill.
//
// Loaded as a plain (non-module) script, before dashboard.js/paytrack.js,
// so it's available the instant the page starts rendering — including
// while fully offline.
(function () {
    const listeners = { online: [], offline: [] };
    let isOnline = navigator.onLine;
    let hideTimer = null;

    function fire(kind) {
        listeners[kind].forEach((cb) => {
            try { cb(); } catch (e) { console.error(e); }
        });
    }

    function setStatus(state, label) {
        const pill = document.getElementById('cloudStatus');
        const textEl = document.getElementById('cloudStatusText');
        clearTimeout(hideTimer);

        if (!pill) return; // page doesn't have the pill (e.g. lock screen) — nothing to update

        pill.classList.remove('opacity-0', 'sync-error', 'sync-offline', 'sync-syncing');

        if (state === 'offline') {
            if (textEl) textEl.textContent = label || 'Offline — changes saved locally';
            pill.classList.add('sync-offline');
            return; // stays visible the whole time we're offline
        }

        if (state === 'syncing') {
            if (textEl) textEl.textContent = label || 'Syncing…';
            pill.classList.add('sync-syncing');
            return;
        }

        if (state === 'error') {
            if (textEl) textEl.textContent = label || 'Sync failed';
            pill.classList.add('sync-error');
            hideTimer = setTimeout(() => pill.classList.add('opacity-0'), 3500);
            return;
        }

        // 'online' / default: brief "Synced" confirmation, then fade out.
        if (textEl) textEl.textContent = label || 'Synced';
        hideTimer = setTimeout(() => pill.classList.add('opacity-0'), 2200);
    }

    window.addEventListener('online', () => {
        isOnline = true;
        fire('online');
    });

    window.addEventListener('offline', () => {
        isOnline = false;
        setStatus('offline');
        fire('offline');
    });

    window.PayTrackNet = {
        get isOnline() { return isOnline; },
        onOnline: (cb) => listeners.online.push(cb),
        onOffline: (cb) => listeners.offline.push(cb),
        setStatus,
    };

    // If the page itself loads while already offline, show that immediately
    // rather than waiting for an 'offline' event that will never fire.
    document.addEventListener('DOMContentLoaded', () => {
        if (!isOnline) setStatus('offline');
    });
})();