// NOTE: auth.js is intentionally never statically imported here. A static
// `import ... from './auth.js'` pulls in auth.js's own static imports of the
// Firebase SDK (from gstatic.com) as one all-or-nothing unit: if that
// network fetch fails (e.g. offline, and it isn't already cached), the
// browser aborts loading THIS ENTIRE MODULE — none of settings.js's code
// runs at all, which is what made the whole Settings page unresponsive
// offline. Every place below uses `await import('./auth.js')` instead, so
// this module always loads and works from local data first; only the
// specific cloud-sync call fails gracefully when there's no connection.

// Registers a Background Sync request so the browser retries a failed
// cloud sync automatically once connectivity returns, even if this tab
// isn't the focused one. Best-effort: unsupported browsers (notably iOS)
// simply no-op here, relying on the next successful in-app sync instead.
function scheduleBackgroundSync() {
    if (!('serviceWorker' in navigator) || !('SyncManager' in window)) return;
    navigator.serviceWorker.ready
        .then((reg) => reg.sync.register('paytrack-sync'))
        .catch(() => {});
}

// Retries a cloud PIN update that failed earlier (see handlePasswordUpdate
// below) because the device was offline. Safe to call speculatively — it's
// a no-op when there's nothing pending.
function flushPendingAccountPin() {
    const pendingPin = localStorage.getItem('pendingAccountPinSync');
    if (!pendingPin) return;
    import('./auth.js')
        .then((auth) => auth.updateAccountPin(pendingPin))
        .then(() => localStorage.removeItem('pendingAccountPinSync'))
        .catch(() => {}); // still offline/failed — leave it queued for next time
}

// When Background Sync fires in the service worker, it messages every open
// PayTrack tab so it can push any pending changes using the data and
// Firebase SDK already available here.
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'PAYTRACK_FLUSH_SYNC') {
            import('./auth.js').then(auth => auth.syncDataToCloud()).catch(() => {});
            flushPendingAccountPin();
        }
    });
}

// Fallback for browsers that don't support Background Sync at all (notably
// iOS): the moment the browser reports connectivity again, try to flush
// right away instead of waiting on a sync event that will never come.
window.addEventListener('online', flushPendingAccountPin);

// Also try once on load — covers the case where the PIN change happened
// offline, the tab was then closed, and the device reconnected before this
// page was reopened (so no 'online' event fires while we're here to hear it).
flushPendingAccountPin();

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
    const customThemeName = document.getElementById('customThemeName');
    const themeTypeSelector = document.getElementById('themeTypeSelector');
    const colorField1 = document.getElementById('colorField1');
    const color1Label = document.getElementById('color1Label');
    const colorPicker1 = document.getElementById('colorPicker1');
    const colorPreview1 = document.getElementById('colorPreview1');
    const customColorInput1 = document.getElementById('customColorInput1');
    const color1Error = document.getElementById('color1Error');
    const gradientOptions = document.getElementById('gradientOptions');
    const colorPicker2 = document.getElementById('colorPicker2');
    const colorPreview2 = document.getElementById('colorPreview2');
    const customColorInput2 = document.getElementById('customColorInput2');
    const color2Error = document.getElementById('color2Error');
    const gradientDirection = document.getElementById('gradientDirection');
    const imageThemeOptions = document.getElementById('imageThemeOptions');
    const themeImageInput = document.getElementById('themeImageInput');
    const chooseThemeImageBtn = document.getElementById('chooseThemeImageBtn');
    const themeImagePreviewWrap = document.getElementById('themeImagePreviewWrap');
    const themeImagePreview = document.getElementById('themeImagePreview');
    const removeThemeImageBtn = document.getElementById('removeThemeImageBtn');
    const themeFullPreview = document.getElementById('themeFullPreview');
    const applyCustomColorBtn = document.getElementById('applyCustomColorBtn');
    const saveThemeBtn = document.getElementById('saveThemeBtn');
    const editingThemeBanner = document.getElementById('editingThemeBanner');
    const editingThemeNameEl = document.getElementById('editingThemeName');
    const cancelEditThemeBtn = document.getElementById('cancelEditThemeBtn');
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
// Optimizes an uploaded image down to ~targetKB (default 30KB) by progressively
// lowering JPEG quality, then shrinking dimensions if that alone isn't enough.
async function compressImage(base64Str, targetKB = 30) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const targetBytes = targetKB * 1024;
            const MAX_WIDTH = 600; // Smaller for feedback
            let width = img.width;
            let height = img.height;
            if (width > MAX_WIDTH) {
                height = Math.round((MAX_WIDTH / width) * height);
                width = MAX_WIDTH;
            }

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            const render = (w, h) => {
                canvas.width = w;
                canvas.height = h;
                ctx.clearRect(0, 0, w, h);
                ctx.drawImage(img, 0, 0, w, h);
            };
            const estimateBytes = (dataUrl) => Math.round(dataUrl.length * 0.75);

            render(width, height);
            let quality = 0.5;
            let result = canvas.toDataURL('image/jpeg', quality);

            while (estimateBytes(result) > targetBytes && quality > 0.1) {
                quality -= 0.1;
                result = canvas.toDataURL('image/jpeg', quality);
            }

            let safety = 0;
            while (estimateBytes(result) > targetBytes && width > 100 && safety < 10) {
                width = Math.round(width * 0.85);
                height = Math.round(height * 0.85);
                render(width, height);
                quality = 0.5;
                result = canvas.toDataURL('image/jpeg', quality);
                while (estimateBytes(result) > targetBytes && quality > 0.1) {
                    quality -= 0.1;
                    result = canvas.toDataURL('image/jpeg', quality);
                }
                safety++;
            }

            resolve(result);
        };
        img.onerror = () => resolve(base64Str);
        img.src = base64Str;
    });
}
    // --- UTILS ---
    const showNotification = (message, type = 'success') => {
        if (window.hideLoading) window.hideLoading(); // action finished, dismiss the loader
        if (!notificationElement) return;
        notificationElement.textContent = message;
        notificationElement.className = `notification ${type}`;
        notificationElement.classList.add('show');
        setTimeout(() => { notificationElement.classList.remove('show'); }, 4000);
    };

    const getSettings = () => JSON.parse(localStorage.getItem(GLOBAL_SETTINGS_KEY)) || {};

    const applyTheme = (themeName = 'default', activeCustomThemeId = null) => {
        document.body.className = document.body.className.replace(/theme-\w+/g, '').trim();
        document.body.style.cssText = '';
        if (themeName === 'custom' && window.ThemeUtils) {
            window.ThemeUtils.applyActiveCustomTheme(activeCustomThemeId);
        } else if (themeName !== 'default') {
            document.body.classList.add(`theme-${themeName}`);
        }
    };

    function updateThemeUI(themeName, activeCustomThemeId = null) {
        document.querySelectorAll('.theme-option').forEach(b => b.classList.toggle('selected', b.dataset.theme === themeName));
        document.querySelectorAll('.saved-theme-button').forEach(b => b.classList.toggle('selected', themeName === 'custom' && b.dataset.themeId === activeCustomThemeId));
    }

    // ==================== THEME CREATOR ====================
    let themeType = 'solid';          // 'solid' | 'gradient' | 'image'
    let themeImageData = null;        // compressed base64 image, when type === 'image'
    let editingThemeId = null;        // set when editing an existing saved theme

    function setThemeType(type) {
        themeType = type;
        document.querySelectorAll('.theme-type-btn').forEach(b => b.classList.toggle('active', b.dataset.type === type));
        color1Label.textContent = type === 'gradient' ? '1' : '';
        gradientOptions.classList.toggle('show', type === 'gradient');
        imageThemeOptions.classList.toggle('hidden', type !== 'image');
        colorField1.classList.toggle('hidden', type === 'image');
        updateFullPreview();
    }

    themeTypeSelector?.addEventListener('click', (e) => {
        const btn = e.target.closest('.theme-type-btn');
        if (btn) setThemeType(btn.dataset.type);
    });

    // --- Color 1 / Color 2 sync: text field <-> native color picker <-> swatch ---
    function wireColorField(textInput, pickerInput, previewEl, errorEl) {
        const handleTextInput = () => {
            const raw = textInput.value.trim();
            if (!raw) {
                errorEl.classList.add('hidden');
                previewEl.style.background = '#f3f4f6';
                updateFullPreview();
                return;
            }
            const resolved = window.ThemeUtils?.resolveColor(raw);
            if (!resolved) {
                errorEl.classList.remove('hidden');
                previewEl.style.background = '#f3f4f6';
            } else {
                errorEl.classList.add('hidden');
                previewEl.style.background = resolved;
                const hex = window.ThemeUtils.rgbStringToHex(resolved);
                if (hex) pickerInput.value = hex;
            }
            updateFullPreview();
        };

        const handlePickerInput = () => {
            textInput.value = pickerInput.value;
            errorEl.classList.add('hidden');
            previewEl.style.background = pickerInput.value;
            updateFullPreview();
        };

        textInput.addEventListener('input', handleTextInput);
        pickerInput.addEventListener('input', handlePickerInput);
    }

    wireColorField(customColorInput1, colorPicker1, colorPreview1, color1Error);
    wireColorField(customColorInput2, colorPicker2, colorPreview2, color2Error);

    // --- Image upload for image-type themes ---
    chooseThemeImageBtn?.addEventListener('click', () => themeImageInput.click());

    themeImageInput?.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        const raw = await new Promise(resolve => {
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(file);
        });
        // Larger target than feedback thumbnails since this fills the whole screen
        themeImageData = await compressImage(raw, 180);
        themeImagePreview.src = themeImageData;
        themeImagePreviewWrap.classList.remove('hidden');
        updateFullPreview();
    });

    removeThemeImageBtn?.addEventListener('click', () => {
        themeImageData = null;
        themeImageInput.value = '';
        themeImagePreviewWrap.classList.add('hidden');
        updateFullPreview();
    });

    // --- Build a theme object from the current form state ---
    function buildThemeFromForm() {
        const color1 = window.ThemeUtils?.resolveColor(customColorInput1.value);
        const color2 = window.ThemeUtils?.resolveColor(customColorInput2.value);

        const theme = {
            name: customThemeName.value.trim(),
            type: themeType,
            color1: color1 || '#764ba2',
            color2: themeType === 'gradient' ? (color2 || '#667eea') : null,
            direction: gradientDirection.value,
            image: themeType === 'image' ? themeImageData : null
        };

        const baseColorForContrast = theme.type === 'image' ? null : theme.color1;
        const contrast = window.ThemeUtils?.getContrastProfile(baseColorForContrast || 'rgb(50,50,80)')
            || { headerText: '#ffffff', headerSubtext: 'rgba(255,255,255,0.85)', buttonBg: 'rgba(255,255,255,0.2)', buttonHoverBg: 'rgba(255,255,255,0.3)', iconFilter: 'brightness(0) invert(1)' };
        // Images vary in brightness across their surface, so default to white text w/ shadow (safe majority case)
        Object.assign(theme, theme.type === 'image' ? { headerText: '#ffffff', headerSubtext: 'rgba(255,255,255,0.9)', buttonBg: 'rgba(255,255,255,0.2)', buttonHoverBg: 'rgba(255,255,255,0.3)', iconFilter: 'brightness(0) invert(1)' } : contrast);

        return theme;
    }

    function isFormValid() {
        if (themeType === 'image') return !!themeImageData;
        if (!window.ThemeUtils?.resolveColor(customColorInput1.value)) return false;
        if (themeType === 'gradient' && !window.ThemeUtils?.resolveColor(customColorInput2.value)) return false;
        return true;
    }

    function updateFullPreview() {
        if (!themeFullPreview) return;
        if (!isFormValid()) {
            themeFullPreview.style.background = '#e5e7eb';
            themeFullPreview.style.color = '#9ca3af';
            themeFullPreview.textContent = 'Enter a valid color to preview';
            return;
        }
        const theme = buildThemeFromForm();
        themeFullPreview.style.background = window.ThemeUtils.getBackgroundValue(theme);
        themeFullPreview.style.color = theme.headerText;
        themeFullPreview.textContent = theme.name || 'Sample Header Text';
    }

    customThemeName?.addEventListener('input', updateFullPreview);
    gradientDirection?.addEventListener('change', updateFullPreview);

    // --- Preview on page (transient — not saved) ---
    applyCustomColorBtn?.addEventListener('click', () => {
        if (!isFormValid()) {
            showNotification('Please enter a valid color first.', 'error');
            return;
        }
        const theme = buildThemeFromForm();
        document.body.className = document.body.className.replace(/theme-\w+/g, '').trim();
        document.body.classList.add('theme-custom');
        window.ThemeUtils.applyCustomThemeVars(theme);
        showNotification('Previewing your theme — Save it to keep it!', 'success');
    });

    // --- Save (or update) the current theme ---
    saveThemeBtn?.addEventListener('click', () => {
        if (!customThemeName.value.trim()) {
            showNotification('Please give your theme a name.', 'error');
            customThemeName.focus();
            return;
        }
        if (!isFormValid()) {
            showNotification('Please fix the highlighted color before saving.', 'error');
            return;
        }

        const theme = buildThemeFromForm();
        const themes = window.ThemeUtils.getCustomThemes();

        if (editingThemeId) {
            const idx = themes.findIndex(t => t.id === editingThemeId);
            if (idx !== -1) themes[idx] = { ...theme, id: editingThemeId };
        } else {
            theme.id = `ct_${Date.now()}`;
            themes.push(theme);
        }
        window.ThemeUtils.saveCustomThemes(themes);

        const activeId = editingThemeId || theme.id;
        let currentSettings = getSettings();
        currentSettings.theme = 'custom';
        currentSettings.activeCustomThemeId = activeId;
        localStorage.setItem(GLOBAL_SETTINGS_KEY, JSON.stringify(currentSettings));

        applyTheme('custom', activeId);
        updateThemeUI('custom', activeId);
        renderSavedThemes('custom', activeId);
        exitEditMode();
        showNotification(editingThemeId ? 'Theme updated!' : 'Theme saved!', 'success');

        import('./auth.js').then(auth => auth.syncDataToCloud()).catch(() => scheduleBackgroundSync());
    });

    function enterEditMode(theme) {
        editingThemeId = theme.id;
        customThemeName.value = theme.name || '';
        setThemeType(theme.type || 'solid');

        customColorInput1.value = theme.color1 || '';
        customColorInput1.dispatchEvent(new Event('input'));

        if (theme.type === 'gradient') {
            customColorInput2.value = theme.color2 || '';
            customColorInput2.dispatchEvent(new Event('input'));
            gradientDirection.value = theme.direction || 'to right';
        }
        if (theme.type === 'image' && theme.image) {
            themeImageData = theme.image;
            themeImagePreview.src = theme.image;
            themeImagePreviewWrap.classList.remove('hidden');
        }

        editingThemeBanner.classList.remove('hidden');
        editingThemeNameEl.textContent = theme.name || '';
        saveThemeBtn.textContent = 'Update Theme';
        updateFullPreview();
        document.getElementById('customColorContainer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function exitEditMode() {
        editingThemeId = null;
        editingThemeBanner.classList.add('hidden');
        saveThemeBtn.textContent = 'Save Current Theme';
        customThemeName.value = '';
    }

    cancelEditThemeBtn?.addEventListener('click', exitEditMode);

    // --- Render "Your Themes" grid ---
    function renderSavedThemes(activeThemeName, activeCustomThemeId) {
        if (!savedThemesContainer) return;
        const themes = window.ThemeUtils.getCustomThemes();

        if (themes.length === 0) {
            savedThemesContainer.innerHTML = '';
            noSavedThemesMsg?.classList.remove('hidden');
            return;
        }
        noSavedThemesMsg?.classList.add('hidden');

        savedThemesContainer.innerHTML = themes.map(t => {
            const bg = window.ThemeUtils.getBackgroundValue(t);
            const isSelected = activeThemeName === 'custom' && activeCustomThemeId === t.id;
            return `
                <button type="button" class="saved-theme-button relative h-16 rounded-lg flex items-center justify-center px-2 ${isSelected ? 'selected' : ''}" data-theme-id="${t.id}" style="background:${bg}; color:${t.headerText || '#ffffff'};">
                    <span class="text-xs font-bold text-center truncate">${t.name}</span>
                    <span class="delete-theme-btn" data-theme-id="${t.id}" title="Delete"><i class="fas fa-times"></i></span>
                    <span class="edit-theme-btn" data-theme-id="${t.id}" title="Edit"><i class="fas fa-pencil"></i></span>
                </button>
            `;
        }).join('');
    }

    // Delegate clicks on saved theme cards: select / edit / delete
    savedThemesContainer?.addEventListener('click', (e) => {
        const themeId = e.target.closest('[data-theme-id]')?.dataset.themeId;
        if (!themeId) return;

        if (e.target.closest('.delete-theme-btn')) {
            if (!confirm('Delete this saved theme?')) return;
            let themes = window.ThemeUtils.getCustomThemes().filter(t => t.id !== themeId);
            window.ThemeUtils.saveCustomThemes(themes);

            let currentSettings = getSettings();
            if (currentSettings.theme === 'custom' && currentSettings.activeCustomThemeId === themeId) {
                currentSettings.theme = 'default';
                delete currentSettings.activeCustomThemeId;
                localStorage.setItem(GLOBAL_SETTINGS_KEY, JSON.stringify(currentSettings));
                applyTheme('default');
                updateThemeUI('default');
            }
            if (editingThemeId === themeId) exitEditMode();
            renderSavedThemes(currentSettings.theme, currentSettings.activeCustomThemeId);
            showNotification('Theme deleted.', 'success');
            return;
        }

        if (e.target.closest('.edit-theme-btn')) {
            const theme = window.ThemeUtils.getCustomThemeById(themeId);
            if (theme) enterEditMode(theme);
            return;
        }

        // Otherwise: select this theme as active
        const theme = window.ThemeUtils.getCustomThemeById(themeId);
        if (!theme) return;
        let currentSettings = getSettings();
        currentSettings.theme = 'custom';
        currentSettings.activeCustomThemeId = themeId;
        localStorage.setItem(GLOBAL_SETTINGS_KEY, JSON.stringify(currentSettings));
        applyTheme('custom', themeId);
        updateThemeUI('custom', themeId);
        renderSavedThemes('custom', themeId);
        import('./auth.js').then(auth => auth.syncDataToCloud()).catch(() => scheduleBackgroundSync());
    });

    // Initialize the creator's default state
    setThemeType('solid');
    customColorInput1.value = '#764ba2';
    customColorInput1.dispatchEvent(new Event('input'));
    customColorInput2.value = '#667eea';
    customColorInput2.dispatchEvent(new Event('input'));
    // ==================== END THEME CREATOR ====================

    // --- UPDATED BIOMETRIC SECURITY LOGIC (CAPACITOR NATIVE) ---
async function initializeBiometrics() {
    if (!biometricToggle) return;

    // Same safety check lock.js uses: if the bridge or plugin isn't
    // available (e.g. the page loaded before Capacitor injected itself,
    // or in a plain browser during development), disable the toggle
    // instead of throwing and leaving it in a broken, clickable state.
    if (!window.Capacitor || !window.Capacitor.Plugins || !window.Capacitor.Plugins.NativeBiometric) {
        biometricToggle.disabled = true;
        if (biometricStatus) {
            biometricStatus.classList.remove('hidden');
            biometricStatus.textContent = "Biometrics not supported or not set up on this device.";
        }
        return;
    }

    const { NativeBiometric } = window.Capacitor.Plugins;

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
    if (!window.Capacitor || !window.Capacitor.Plugins || !window.Capacitor.Plugins.NativeBiometric) {
        biometricToggle.checked = false;
        showNotification('Biometrics are not available on this device.', 'error');
        return;
    }
    const { NativeBiometric } = window.Capacitor.Plugins;

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
    // This one PIN is intentionally shared everywhere: unlocking the app
    // (lock.html reads the same DELETE_PASSWORD_KEY), confirming a project
    // deletion (dashboard.js reads it too), and — via updateAccountPin
    // below — logging into this account from login.html on any device.
    function handlePasswordUpdate(event) {
        event.preventDefault();
        const current = currentPasswordInput.value;
        const newP = newPasswordInput.value;
        const confirmP = confirmPasswordInput.value;
        const stored = localStorage.getItem(DELETE_PASSWORD_KEY) || '0000';

        if (current !== stored) return showNotification('Current PIN is incorrect.', 'error');
        if (newP.length !== 4) return showNotification('PIN must be 4 digits.', 'error');
        if (newP !== confirmP) return showNotification('PINs do not match.', 'error');

        // Applies immediately and locally first — the lock screen and project
        // deletion already read straight from this same key, so they pick up
        // the new PIN right away regardless of connectivity.
        localStorage.setItem(DELETE_PASSWORD_KEY, newP);
        passwordForm.reset();

        const username = localStorage.getItem('paytrackUsername');
        if (!username) {
            // No cloud account on this device — the local PIN change is the
            // whole story.
            showNotification('PIN updated!', 'success');
            return;
        }

        // Also push the same PIN to the cloud account so it works for
        // logging in from login.html, on this device or any other.
        import('./auth.js')
            .then((auth) => auth.updateAccountPin(newP))
            .then(() => {
                localStorage.removeItem('pendingAccountPinSync');
                showNotification('PIN updated everywhere!', 'success');
            })
            .catch((e) => {
                console.error('Account PIN sync failed:', e);
                // Remember the PIN that still needs to reach the cloud so the
                // retry paths below (flush message, 'online' event, or next
                // page load) can actually finish the job later, instead of
                // just promising to and never following through.
                localStorage.setItem('pendingAccountPinSync', newP);
                scheduleBackgroundSync();
                showNotification("PIN updated on this device — will sync to your account when you're back online", 'success');
            });
    }

    // --- INITIALIZE PAGE ---
    function initializePage() {
        // 1. Handle Translations (if the file is loaded)
        if (typeof translatePage === 'function') translatePage(); 
        
        // 2. Load and Apply Themes
        const settings = getSettings();
        applyTheme(settings.theme || 'default', settings.activeCustomThemeId);
        updateThemeUI(settings.theme || 'default', settings.activeCustomThemeId);
        renderSavedThemes(settings.theme, settings.activeCustomThemeId);

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

        // 3b. Live cross-device sync: if settings/theme change on another
        // device while this page is open here, reflect it immediately
        // instead of waiting for the next visit. Mirrors the same
        // subscribeToUserData listener dashboard.js already uses for the
        // project list. auth.js's onSnapshot already ignores this device's
        // own writes echoing back (hasPendingWrites), so this never fights
        // with what the person is actively doing on this page.
        if (username) {
            import('./auth.js').then((auth) => {
                auth.subscribeToUserData(username, (newData) => {
                    if (newData.globalSettings) {
                        const s = newData.globalSettings;
                        applyTheme(s.theme || 'default', s.activeCustomThemeId);
                        updateThemeUI(s.theme || 'default', s.activeCustomThemeId);
                        renderSavedThemes(s.theme, s.activeCustomThemeId);
                        if (currencySelector && s.currency) currencySelector.value = s.currency;
                    }
                    if (typeof translatePage === 'function') translatePage();
                });
            }).catch(() => {}); // offline — settings.js already works fully from local data
        }

        // 4. Setup Theme Selector Event (When clicking blue, green, etc.)
        if (themeSelector) {
            themeSelector.onclick = (e) => {
                const btn = e.target.closest('.theme-option');
                if (btn) {
                    const themeName = btn.dataset.theme;
                    let currentSettings = getSettings();
                    currentSettings.theme = themeName;
                    delete currentSettings.activeCustomThemeId;
                    
                    // Save locally
                    localStorage.setItem(GLOBAL_SETTINGS_KEY, JSON.stringify(currentSettings));
                    
                    // Apply immediately
                    applyTheme(themeName);
                    updateThemeUI(themeName);

                    // Sync settings change to the cloud
                    import('./auth.js').then(auth => auth.syncDataToCloud()).catch(() => scheduleBackgroundSync());
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
                scheduleBackgroundSync();
            }
        };
    }
        // Language
        if(languageSelector) {
            languageSelector.onchange = () => {
                const newLang = languageSelector.value;
                if(window.setLanguage) window.setLanguage(newLang);

                import('./auth.js').then(auth => auth.syncDataToCloud()).catch(() => scheduleBackgroundSync());
            };
        }
    }

    initializePage();
});