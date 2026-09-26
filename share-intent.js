// share-intent.js
// ---------------------------------------------------------------------
// Makes PayTrack appear in Android's share sheet for images, so a user can
// share a receipt photo from WhatsApp, their Gallery, a file manager, etc.
// straight into PayTrack instead of saving it and reopening the app.
//
// Requires the @capgo/capacitor-share-target plugin (native-only — this
// file no-ops completely on a plain website or in the browser preview) and
// an intent-filter for ACTION_SEND/image/* added to AndroidManifest.xml.
// See the setup notes at the bottom of this file.
//
// Like NativeBiometric elsewhere in this app, the plugin is reached
// through window.Capacitor.Plugins — no bundler or ES-module import
// needed, so this works as a plain <script> tag just like every other
// file in this project.
//
// Flow:
//   1. Someone shares an image to PayTrack. Android launches/resumes the
//      app and this listener fires with the file's native URI.
//   2. We store a tiny {uri, name, mimeType} pointer in sessionStorage —
//      never the image bytes themselves, so this is cheap and safe however
//      many pages it has to survive.
//   3. If we're already sitting on an open project (paytrack.html), we
//      scan it straight into that project. Otherwise we send the user to
//      dashboard.html, which prompts them to pick which project it goes
//      into (see dashboard.js's checkPendingSharedReceipt()).
(function () {
    function isNativeApp() {
        return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    }

    async function handleSharedImage(file) {
        sessionStorage.setItem('paytrackPendingSharedReceipt', JSON.stringify({
            uri: file.uri,
            name: file.name,
            mimeType: file.mimeType
        }));

        // Already inside a project? Scan straight into it, no picker needed.
        if (window.PayTrackReceiptIntake && typeof window.PayTrackReceiptIntake.processPendingSharedReceipt === 'function') {
            window.PayTrackReceiptIntake.processPendingSharedReceipt();
            return;
        }

        // Already on the dashboard? Let it react immediately instead of a
        // pointless reload.
        if (/dashboard\.html$/i.test(window.location.pathname)) {
            window.dispatchEvent(new CustomEvent('paytrack:incoming-receipt'));
            return;
        }

        // On the lock screen: leave the flag for dashboard.html to pick up
        // once the user unlocks — forcing a navigation now would fight with
        // lock.js's own post-PIN redirect.
        if (/lock\.html$/i.test(window.location.pathname)) return;

        // Any other page (settings, splash, etc.) — send them to pick a project.
        window.location.href = 'dashboard.html';
    }

    async function init() {
        if (!isNativeApp()) return;
        if (!window.Capacitor.Plugins || !window.Capacitor.Plugins.CapacitorShareTarget) {
            console.log('share-intent.js: CapacitorShareTarget plugin not found — see setup notes in this file.');
            return;
        }
        try {
            const { CapacitorShareTarget } = window.Capacitor.Plugins;
            await CapacitorShareTarget.addListener('shareReceived', (event) => {
                const imageFile = (event.files || []).find(f => (f.mimeType || '').startsWith('image/'));
                if (imageFile) handleSharedImage(imageFile);
            });
        } catch (e) {
            console.error('share-intent.js: failed to register share listener', e);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

// ---------------------------------------------------------------------
// SETUP NEEDED (one-time, native project changes — do these yourself):
//
// 1. Install the plugin and sync:
//      npm install @capgo/capacitor-share-target
//      npx cap sync android
//
// 2. In android/app/src/main/AndroidManifest.xml, inside the SAME
//    <activity> block that already has your MAIN/LAUNCHER intent-filter,
//    add a second intent-filter so Android offers PayTrack in the share
//    sheet for images:
//
//      <intent-filter>
//          <action android:name="android.intent.action.SEND" />
//          <category android:name="android.intent.category.DEFAULT" />
//          <data android:mimeType="image/*" />
//      </intent-filter>
//
// That's it — no JS import step needed. Rebuild and reinstall the app
// after step 2, and PayTrack will appear in the Android share sheet
// whenever you share an image from any other app.
// ---------------------------------------------------------------------
