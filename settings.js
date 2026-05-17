import { subscribeToUserData, syncDataToCloud } from './auth.js';
import { submitFeedbackToCloud } from './auth.js';

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
    

    // --- FEEDBACK LOGIC ---
let selectedStars = 0;
let feedbackTempImages = [];

const starContainer = document.getElementById('starRatingContainer');
const feedbackImagesInput = document.getElementById('feedbackImages');
const feedbackPreview = document.getElementById('feedbackImagePreview');
const submitFeedbackBtn = document.getElementById('submitFeedbackBtn');

// 1. Handle Star Clicks
if (starContainer) {
    starContainer.addEventListener('click', (e) => {
        const star = e.target.closest('.star-btn');
        if (!star) return;
        selectedStars = parseInt(star.dataset.index);
        
        // Update UI
        const allStars = starContainer.querySelectorAll('.star-btn');
        allStars.forEach((s, idx) => {
            if (idx < selectedStars) {
                s.classList.add('active', 'fas');
                s.classList.remove('far');
            } else {
                s.classList.remove('active', 'fas');
                s.classList.add('far');
            }
        });
    });
}

// 2. Handle Image Upload & Compression
if (feedbackImagesInput) {
    feedbackImagesInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        for (const file of files) {
            const reader = new FileReader();
            const rawBase64 = await new Promise(resolve => {
                reader.onload = () => resolve(reader.result);
                reader.readAsDataURL(file);
            });
            
            // Reuse your existing compression logic (ensure compressImage function is accessible)
            const compressed = await compressImage(rawBase64); 
            feedbackTempImages.push(compressed);
        }
        renderFeedbackPreviews();
    });
}

function renderFeedbackPreviews() {
    feedbackPreview.innerHTML = '';
    feedbackTempImages.forEach((src, idx) => {
        const div = document.createElement('div');
        div.className = 'relative aspect-square';
        div.innerHTML = `
            <img src="${src}" class="w-full h-full object-cover rounded-lg border">
            <button onclick="removeFeedbackImage(${idx})" class="absolute -top-1 -right-1 bg-red-500 text-white w-5 h-5 rounded-full text-[10px]">×</button>
        `;
        feedbackPreview.appendChild(div);
    });
}

window.removeFeedbackImage = (idx) => {
    feedbackTempImages.splice(idx, 1);
    renderFeedbackPreviews();
};

// 3. Submit Feedback
if (submitFeedbackBtn) {
    submitFeedbackBtn.onclick = async () => {
        const text = document.getElementById('feedbackText').value.trim();
        const btnText = document.getElementById('feedbackBtnText');
        const spinner = document.getElementById('feedbackSpinner');

        if (!text && selectedStars === 0) {
            showNotification("Please provide a rating or a message.", "error");
            return;
        }

        // UI Loading State
        submitFeedbackBtn.disabled = true;
        spinner.classList.remove('hidden');
        btnText.textContent = "Sending...";

        const feedbackData = {
            username: localStorage.getItem('paytrackUsername') || 'Anonymous',
            deviceId: localStorage.getItem('paytrackDeviceId'),
            rating: selectedStars,
            message: text,
            // Ensure images are strictly an array of strings
            images: feedbackTempImages, 
            submittedAt: new Date().toLocaleString()
        };

        try {
            // Import and call the submission function
            const { submitFeedbackToCloud } = await import('./auth.js');
            await submitFeedbackToCloud(feedbackData);

            // --- THE FIX: Clear form and show success message ---
            showNotification("✅ Feedback Submitted Successfully!", "success");
            alert("Thank you! Your feedback has been received.");

            // Reset UI
            document.getElementById('feedbackText').value = '';
            selectedStars = 0;
            feedbackTempImages = [];
            document.getElementById('feedbackImagePreview').innerHTML = '';
            starContainer.querySelectorAll('.star-btn').forEach(s => {
                s.classList.replace('fas', 'far');
                s.classList.remove('active');
            });

        } catch (e) {
            console.error(e);
            if (e.message.includes("too large")) {
                showNotification("Error: Images are too large. Please send fewer screenshots.", "error");
            } else {
                showNotification("Failed to send feedback. Check internet.", "error");
            }
        } finally {
            submitFeedbackBtn.disabled = false;
            spinner.classList.add('hidden');
            btnText.textContent = "Submit Feedback";
        }
    };
}
async function compressImage(base64Str) {
    return new Promise((resolve) => {
        const img = new Image();
        img.src = base64Str;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 600; // Smaller for feedback
            let width = img.width;
            let height = img.height;
            if (width > MAX_WIDTH) {
                height = (MAX_WIDTH / width) * height;
                width = MAX_WIDTH;
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', 0.5)); 
        };
    });
}
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
    logoutBtn.onclick = async () => {
        const confirmLogout = confirm("Logout? This will remove all projects from this device for security.");
        
        if (confirmLogout) {
            // UI LOADER
            const btnText = document.getElementById('logoutBtnText');
            const spinner = document.getElementById('logoutSpinner');
            
            logoutBtn.disabled = true;
            spinner.classList.remove('hidden');
            btnText.textContent = "Logging out...";

            try {
                const auth = await import('./auth.js');
                // Ensure logoutUser in auth.js is awaited
                await auth.logoutUser(); 
            } catch (err) {
                console.error("Logout failed:", err);
                // Fallback reset if cloud fails
                localStorage.clear();
                sessionStorage.clear();
                window.location.replace('login.html');
            }
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
    // 1. Get the current settings from localStorage
    const settings = JSON.parse(localStorage.getItem('dashboardGlobalSettings')) || {};

    if (currencySelector) {
        // 2. FORCE the dropdown to show the saved currency (e.g., "PKR")
        // If nothing is saved, default to "USD"
        const savedCurrency = settings.currency || 'USD';
        currencySelector.value = savedCurrency;
        
        console.log("Settings: Initialized currency dropdown to:", savedCurrency);

        currencySelector.onchange = async () => {
            // Get a fresh copy of settings
            let currentSettings = JSON.parse(localStorage.getItem('dashboardGlobalSettings')) || {};
            
            const selectedOption = currencySelector.options[currencySelector.selectedIndex];
            
            // 3. Save BOTH the code and the symbol
            currentSettings.currency = selectedOption.value; // e.g., "PKR"
            currentSettings.currencySymbol = selectedOption.dataset.symbol; // e.g., "Rs"
            
            // Update LocalStorage
            localStorage.setItem('dashboardGlobalSettings', JSON.stringify(currentSettings));
            
            showNotification(`Currency updated to ${currentSettings.currency}`, 'success');

            // 4. URGENT: Sync this to the cloud immediately so the Dashboard doesn't overwrite it
            try {
                const auth = await import('./auth.js');
                await auth.syncDataToCloud();
                console.log("Settings: Cloud sync successful");
            } catch (e) {
                console.error("Settings: Sync failed", e);
            }
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