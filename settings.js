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

    // --- BIOMETRIC SECURITY LOGIC ---
    async function initializeBiometrics() {
        if (!biometricToggle) return;

        // 1. Check Browser Support
        if (!window.PublicKeyCredential) {
            biometricToggle.disabled = true;
            biometricStatus?.classList.remove('hidden');
            if(biometricStatus) biometricStatus.textContent = "Not supported by this browser.";
            return;
        }

        // 2. Check Hardware Support (Fingerprint/FaceID)
        const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        
        if (!available) {
            biometricToggle.disabled = true;
            biometricStatus?.classList.remove('hidden');
            if(biometricStatus) biometricStatus.textContent = "No biometric hardware found on this device.";
            return;
        }

        // 3. Load Saved State
        const isEnabled = localStorage.getItem(BIOMETRIC_KEY) === 'true';
        biometricToggle.checked = isEnabled;
        biometricToggle.addEventListener('change', handleBiometricToggle);
    }

    async function handleBiometricToggle() {
        if (biometricToggle.checked) {
            const success = await registerBiometric();
            if (success) {
                localStorage.setItem(BIOMETRIC_KEY, 'true');
                showNotification('Biometrics Enabled!', 'success');
            } else {
                biometricToggle.checked = false; 
                localStorage.setItem(BIOMETRIC_KEY, 'false');
                showNotification('Biometric setup failed.', 'error');
            }
        } else {
            localStorage.setItem(BIOMETRIC_KEY, 'false');
            localStorage.removeItem(CREDENTIAL_ID_KEY);
            showNotification('Biometrics Disabled.', 'success');
        }
    }

    async function registerBiometric() {
        try {
            const challenge = new Uint8Array(32);
            window.crypto.getRandomValues(challenge);
            const userId = "User_" + Date.now();
            const idBuffer = new TextEncoder().encode(userId);

            const publicKey = {
                challenge: challenge,
                rp: { name: "PayTrack App", id: window.location.hostname },
                user: { id: idBuffer, name: userId, displayName: "PayTrack Owner" },
                pubKeyCredParams: [{ alg: -7, type: "public-key" }, { alg: -257, type: "public-key" }],
                authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
                timeout: 60000,
                attestation: "none"
            };

            const credential = await navigator.credentials.create({ publicKey });
            const bufferToBase64 = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)));
            localStorage.setItem(CREDENTIAL_ID_KEY, bufferToBase64(credential.rawId));
            return true;
        } catch (err) {
            return false;
        }
    }

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