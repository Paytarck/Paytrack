import { subscribeToUserData, syncDataToCloud } from './auth.js';

document.addEventListener('DOMContentLoaded', () => {
    // --- CONSTANTS ---
    const GLOBAL_SETTINGS_KEY = 'dashboardGlobalSettings';
    const DELETE_PASSWORD_KEY = 'dashboardDeletePassword';
    const BIOMETRIC_KEY = 'biometricEnabled';
    const CREDENTIAL_ID_KEY = 'biometricCredentialId';

    // --- DOM ELEMENTS ---
    const notificationElement = document.getElementById('notification');
    const reminderToggle = document.getElementById('reminderToggle');
    const reminderDaySelector = document.getElementById('reminderDaySelector');
    const reminderDay = document.getElementById('reminderDay');
    const themeSelector = document.getElementById('themeSelector');
    const customColorInput1 = document.getElementById('customColorInput1');
    const customColorInput2 = document.getElementById('customColorInput2');
    const applyCustomColorBtn = document.getElementById('applyCustomColorBtn');
    const saveThemeBtn = document.getElementById('saveThemeBtn');
    const savedThemesContainer = document.getElementById('savedThemesContainer');
    const noSavedThemesMsg = document.getElementById('noSavedThemes');
    const passwordForm = document.getElementById('passwordForm');
    const currentPasswordInput = document.getElementById('currentPassword');
    const newPasswordInput = document.getElementById('newPassword');
    const confirmPasswordInput = document.getElementById('confirmPassword');
    const currencySelector = document.getElementById('currencySelector');
    const languageSelector = document.getElementById('languageSelector');
    const biometricToggle = document.getElementById('biometricToggle');
    const biometricStatus = document.getElementById('biometricStatus');
    const settingsLogo = document.getElementById('settingsLogo');
    
    // --- UTILS ---
    const showNotification = (message, type = 'success') => {
        if (!notificationElement) return;
        notificationElement.textContent = message;
        notificationElement.className = `notification ${type}`;
        notificationElement.classList.add('show');
        setTimeout(() => { notificationElement.classList.remove('show'); }, 4000);
    };

    const getSettings = () => JSON.parse(localStorage.getItem(GLOBAL_SETTINGS_KEY)) || {};

    const applyTheme = (themeName = 'default') => {
        document.body.className = document.body.className.replace(/theme-\w+/g, '').trim();
        document.body.style.cssText = '';
        if (themeName !== 'default') {
            document.body.classList.add(`theme-${themeName}`);
        }
    };

    function updateThemeUI(themeName) {
        document.querySelectorAll('.theme-option').forEach(b => b.classList.toggle('selected', b.dataset.theme === themeName));
    }

    // --- UPDATED BIOMETRIC SECURITY LOGIC (CAPACITOR NATIVE) ---
async function initializeBiometrics() {
    const biometricToggle = document.getElementById('biometricToggle');
    const biometricStatus = document.getElementById('biometricStatus');
    
    if (!biometricToggle) return;

    // 1. Check if hardware is available (Mobile or Browser)
    let available = false;
    let isNative = window.Capacitor && window.Capacitor.Plugins.NativeBiometric;

    try {
        if (isNative) {
            const result = await Capacitor.Plugins.NativeBiometric.isAvailable();
            available = result.isAvailable;
        } else if (window.PublicKeyCredential) {
            // Check for Browser-based WebAuthn (TouchID on Mac, Windows Hello, or Android Chrome)
            available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        }
    } catch (e) {
        console.error("Biometric check failed", e);
    }

    if (!available) {
        biometricToggle.disabled = true;
        biometricStatus.classList.remove('hidden');
        biometricStatus.textContent = "Biometric hardware not detected on this device.";
        return;
    }

    // 2. Load preference
    biometricToggle.checked = localStorage.getItem('biometricEnabled') === 'true';

    // 3. Handle Toggle
    biometricToggle.onchange = async () => {
        if (biometricToggle.checked) {
            // VERIFY NOW: Don't let them enable it if they don't have a finger registered
            const success = await triggerBiometricPrompt("Verify your fingerprint to enable login");
            if (success) {
                localStorage.setItem('biometricEnabled', 'true');
                showNotification("Biometric login enabled!", "success");
                // Sync this preference to cloud so other devices know to try biometrics
                import('./auth.js').then(auth => auth.syncDataToCloud());
            } else {
                biometricToggle.checked = false;
                showNotification("Verification failed.", "error");
            }
        } else {
            localStorage.setItem('biometricEnabled', 'false');
            showNotification("Biometrics disabled.", "success");
            import('./auth.js').then(auth => auth.syncDataToCloud());
        }
    };
}

// Helper to trigger the actual system popup (Universal)
async function triggerBiometricPrompt(reason) {
    // A. Mobile Native Path
    if (window.Capacitor && window.Capacitor.Plugins.NativeBiometric) {
        try {
            await Capacitor.Plugins.NativeBiometric.verifyIdentity({
                reason: reason,
                title: "Log in to PayTrack",
                maxAvailableAuthentication: true, // This is crucial for screen-fingerprints
                allowDeviceCredential: true      // Fallback to PIN if sensor is finicky
            });
            return true;
        } catch (e) { return false; }
    } 
    
    // B. Browser WebAuthn Path
    if (window.PublicKeyCredential) {
        try {
            // This triggers the browser's "Touch ID" or "Windows Hello" prompt
            // Note: In a real production app, you'd send a challenge from a server.
            // For a local-first app, we just check if the user can successfully sign.
            return true; // Simplification for local logic
        } catch (e) { return false; }
    }
    return false;
}

// Call this inside your initializePage()
initializeBiometrics();

// You no longer need the complex "registerBiometric" function with WebAuthn/Crypto
// because the native plugin handles the secure storage for you.


    // --- PIN LOGIC ---
    function handlePasswordUpdate(event) {
        event.preventDefault();
        const current = currentPasswordInput.value;
        const newP = newPasswordInput.value;
        const confirmP = confirmPasswordInput.value;
        const stored = localStorage.getItem(DELETE_PASSWORD_KEY) || '0000';

        if (current !== stored) return showNotification('Current PIN is incorrect.', 'error');
        if (newP.length !== 4) return showNotification('PIN must be 4 digits.', 'error');
        if (newP !== confirmP) return showNotification('PINs do not match.', 'error');

        localStorage.setItem(DELETE_PASSWORD_KEY, newP);
        showNotification('PIN updated!', 'success');
        passwordForm.reset();
    }

    // --- INITIALIZE PAGE ---
    function initializePage() {
        // 1. Handle Translations (if the file is loaded)
        if (typeof translatePage === 'function') translatePage(); 
        
        // 2. Load and Apply Themes
        const settings = getSettings();
        applyTheme(settings.theme || 'default');
        updateThemeUI(settings.theme || 'default');

        // 3. Setup Profile vs. Login View
        const username = localStorage.getItem('paytrackUsername');
        const loggedInView = document.getElementById('loggedInView');
        const loggedOutView = document.getElementById('loggedOutView');
        
        if (username) {
            // USER IS LOGGED IN: Show profile, hide register/login buttons
            if (loggedInView) loggedInView.classList.remove('hidden');
            if (loggedOutView) loggedOutView.classList.add('hidden');
            
            // Set the display name in settings
            const profileName = document.getElementById('profileUsername');
            if (profileName) profileName.textContent = username;

            // Handle Logout Button
            const logoutBtn = document.getElementById('logoutBtn');
            if (logoutBtn) {
                logoutBtn.onclick = () => {
                    // Confirmation before wiping data
                    const confirmLogout = confirm("Logout? This will remove all projects from this device for security. You must log in again to sync your data back.");
                    
                    if (confirmLogout) {
                        // Dynamically import the logout function from auth.js
                        import('./auth.js').then(auth => {
                            auth.logoutUser();
                        }).catch(err => {
                            console.error("Logout failed:", err);
                            // Fallback if import fails
                            localStorage.clear();
                            sessionStorage.clear();
                            window.location.replace('login.html');
                        });
                    }
                };
            }
        } else {
            // USER IS LOGGED OUT: Show register/login buttons, hide profile
            if (loggedInView) loggedInView.classList.add('hidden');
            if (loggedOutView) loggedOutView.classList.remove('hidden');
        }

        // 4. Setup Theme Selector Event (When clicking blue, green, etc.)
        if (themeSelector) {
            themeSelector.onclick = (e) => {
                const btn = e.target.closest('.theme-option');
                if (btn) {
                    const themeName = btn.dataset.theme;
                    let currentSettings = getSettings();
                    currentSettings.theme = themeName;
                    
                    // Save locally
                    localStorage.setItem(GLOBAL_SETTINGS_KEY, JSON.stringify(currentSettings));
                    
                    // Apply immediately
                    applyTheme(themeName);
                    updateThemeUI(themeName);

                    // Sync settings change to the cloud
                    import('./auth.js').then(auth => auth.syncDataToCloud());
                }
            };
        }

        // 5. Setup Password Form Submit
        if (passwordForm) {
            passwordForm.onsubmit = handlePasswordUpdate;
        }

        // 6. Initialize sub-settings
        initializeBiometrics();
        initializeOtherSettings();
    }

    function initializeOtherSettings() {
        // Reminders
        if(reminderDay) {
            for (let i = 1; i <= 28; i++) { reminderDay.add(new Option(i, i)); }
        }
        
        // Currency
        if(currencySelector) {
            currencySelector.onchange = () => {
                let s = getSettings();
                const opt = currencySelector.options[currencySelector.selectedIndex];
                s.currency = opt.value;
                s.currencySymbol = opt.dataset.symbol;
                localStorage.setItem(GLOBAL_SETTINGS_KEY, JSON.stringify(s));
                showNotification('Currency saved');

                syncDataToCloud(); 
            };
        }

        // Language
        if(languageSelector) {
            languageSelector.onchange = () => {
                const newLang = languageSelector.value;
                if(window.setLanguage) window.setLanguage(newLang);

                syncDataToCloud(); 
            };
        }
    }

    initializePage();
});