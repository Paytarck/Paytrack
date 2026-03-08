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
        if(typeof translatePage === 'function') translatePage(); 
        
        const settings = getSettings();
        applyTheme(settings.theme || 'default');
        updateThemeUI(settings.theme || 'default');

        // Profile / Login Visibility Logic
        const username = localStorage.getItem('paytrackUsername');
        const loggedInView = document.getElementById('loggedInView');
        const loggedOutView = document.getElementById('loggedOutView');
        
        if (username) {
            // SHOW profile, HIDE login
            loggedInView?.classList.remove('hidden');
            loggedOutView?.classList.add('hidden');
            
            const profileName = document.getElementById('profileUsername');
            if(profileName) profileName.textContent = username;

            const logoutBtn = document.getElementById('logoutBtn');
            if(logoutBtn) {
                logoutBtn.onclick = () => {
                    localStorage.removeItem('paytrackUsername');
                    sessionStorage.removeItem('paytrackUserSession');
                    window.location.reload();
                };
            }
        } else {
            // HIDE profile, SHOW login (Fixed this part)
            loggedInView?.classList.add('hidden');
            loggedOutView?.classList.remove('hidden');
        }

        // Event Listeners
        if(themeSelector) {
            themeSelector.onclick = (e) => {
                const btn = e.target.closest('.theme-option');
                if(btn) {
                    const t = btn.dataset.theme;
                    let s = getSettings();
                    s.theme = t;
                    localStorage.setItem(GLOBAL_SETTINGS_KEY, JSON.stringify(s));
                    applyTheme(t);
                    updateThemeUI(t);

                    syncDataToCloud(); 
                }
            };
        }

        if(passwordForm) passwordForm.onsubmit = handlePasswordUpdate;

        // Run other setups
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