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
    if (!biometricToggle) return;

    const { NativeBiometric } = Capacitor.Plugins;

    // 1. Check if the device has biometric hardware (Fingerprint/FaceID)
    try {
        const result = await NativeBiometric.isAvailable();
        
        if (!result.isAvailable) {
            biometricToggle.disabled = true;
            if (biometricStatus) {
                biometricStatus.classList.remove('hidden');
                biometricStatus.textContent = "Biometrics not supported or not set up on this device.";
            }
            return;
        }

        // 2. Load Saved State from localStorage
        const isEnabled = localStorage.getItem(BIOMETRIC_KEY) === 'true';
        biometricToggle.checked = isEnabled;
        
        // Remove old listeners to prevent double-firing
        biometricToggle.removeEventListener('change', handleBiometricToggle);
        biometricToggle.addEventListener('change', handleBiometricToggle);

    } catch (err) {
        console.error("Biometric init error:", err);
    }
}

async function handleBiometricToggle() {
    const { NativeBiometric } = Capacitor.Plugins;

    if (biometricToggle.checked) {
        try {
            // Fix for in-display sensors: 
            // We add a tiny delay to let the UI settle before calling the system
            await new Promise(resolve => setTimeout(resolve, 200));

            await NativeBiometric.verifyIdentity({
                reason: "Confirm identity to enable PayTrack biometrics",
                title: "Biometric Verification",
                subtitle: "Touch the sensor to enable",
                description: "Verify your fingerprint or face to continue",
                // ADD THESE LINES BELOW:
                maxAvailableAuthentication: true, // Allows "weak" sensors (common in mid-range in-display)
                allowDeviceCredential: true      // Allows PIN fallback if the fingerprint UI hangs
            });

            localStorage.setItem(BIOMETRIC_KEY, 'true');
            showNotification('Biometrics Enabled!', 'success');
        } catch (error) {
            console.error("Biometric setup failed:", error);
            biometricToggle.checked = false;
            localStorage.setItem(BIOMETRIC_KEY, 'false');
            
            // If it failed specifically on his phone, show a helpful message
            showNotification('Verification failed. Try using your phone PIN instead.', 'error');
        }
    } else {
        localStorage.setItem(BIOMETRIC_KEY, 'false');
        showNotification('Biometrics Disabled.', 'success');
    }
}

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