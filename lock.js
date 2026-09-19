document.addEventListener('DOMContentLoaded', () => {
    // --- DOM ELEMENTS ---
    const pinInput = document.getElementById('pinInput');
    const dots = document.querySelectorAll('.dot');
    const keypad = document.getElementById('keypad');
    const feedbackMessage = document.getElementById('feedbackMessage');
    const pinDisplayArea = document.getElementById('pinDisplayArea');
    const pinTitle = document.getElementById('pinTitle');
    const pinSubtitle = document.getElementById('pinSubtitle');
    const biometricContainer = document.getElementById('biometricContainer');
    const biometricBtn = document.getElementById('biometricBtn');

    // --- CONFIG ---
    const USER_SESSION_KEY = 'paytrackUserSession';
    const PIN_STORAGE_KEY = 'dashboardDeletePassword'; 
    const BIOMETRIC_KEY = 'biometricEnabled';
    const CREDENTIAL_ID_KEY = 'biometricCredentialId';
    const MAX_ATTEMPTS = 4
    const LOCKOUT_DURATION = 30; 

    // --- STATE ---
    let mode = 'login'; 
    let tempPin = '';   
    let failedAttempts = 0;
    let isProcessing = false;
    let lockoutInterval = null;

    // --- UTILS ---
    const base64ToBuffer = (base64) => {
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    };

    // --- INITIALIZATION ---
    const initialize = () => {
        if (typeof translatePage === 'function') translatePage();

        if (sessionStorage.getItem(USER_SESSION_KEY) === 'true') {
            window.location.replace('dashboard.html');
            return;
        }

        const storedPin = localStorage.getItem(PIN_STORAGE_KEY);
        if (!storedPin) {
            setMode('create');
        } else {
            setMode('login');
            setTimeout(checkBiometric, 500); 
        }
    };

    // --- UI HELPERS ---
    const setMode = (newMode) => {
        mode = newMode;
        resetInput();
        feedbackMessage.className = 'feedback-badge hidden';
        const textGroup = document.querySelector('.text-group');
        textGroup.style.opacity = '0';
        setTimeout(() => {
            if (mode === 'login') {
                pinTitle.textContent = "Welcome Back";
                pinSubtitle.textContent = "Enter your PIN to access";
            } else if (mode === 'create') {
                pinTitle.textContent = "Setup Security";
                pinSubtitle.textContent = "Create a 4-digit PIN";
            } else if (mode === 'confirm') {
                pinTitle.textContent = "Confirm PIN";
                pinSubtitle.textContent = "Re-enter to verify";
            }
            textGroup.style.opacity = '1';
        }, 200);
    };

    const resetInput = () => {
        pinInput.value = '';
        updateDots();
        resetDotColors();
        isProcessing = false;
    };

    const updateDots = () => {
        const valLength = pinInput.value.length;
        dots.forEach((dot, index) => {
            if (index < valLength) dot.classList.add('filled');
            else dot.classList.remove('filled');
        });
    };

    const colorDots = (status) => {
        dots.forEach(dot => {
            if (dot.classList.contains('filled')) dot.classList.add(status);
        });
    };

    const resetDotColors = () => {
        dots.forEach(dot => dot.classList.remove('success', 'error'));
    };

    const showFeedback = (msg, type) => {
        feedbackMessage.textContent = msg;
        feedbackMessage.className = `feedback-badge ${type}`;
        void feedbackMessage.offsetWidth; 
    };

    const shakeUI = () => {
        const card = document.querySelector('.lock-card');
        card.classList.add('shake');
        setTimeout(() => card.classList.remove('shake'), 400);
    };

    // --- UPDATED BIOMETRIC LOGIC (CAPACITOR NATIVE) ---
const checkBiometric = async () => {
    // 1. SAFETY CHECK: If the plugin is missing, hide the button
    if (!window.Capacitor || !window.Capacitor.Plugins.NativeBiometric) {
        if (biometricContainer) biometricContainer.classList.add('hidden');
        return; 
    }

    const { NativeBiometric } = window.Capacitor.Plugins;

    try {
        const result = await NativeBiometric.isAvailable();
        const isEnabled = localStorage.getItem(BIOMETRIC_KEY) === 'true';

        if (isEnabled && result.isAvailable) {
            biometricContainer.classList.remove('hidden');
            biometricBtn.addEventListener('click', triggerBiometricAuth);

            // --- NEW: AUTO-PROMPT FEATURE ---
            // This triggers the fingerprint prompt automatically 600ms after the page loads
            setTimeout(() => {
                triggerBiometricAuth();
            }, 600);
        }
    } catch (err) {
        console.error("Biometric init error:", err);
    }
};

const triggerBiometricAuth = async () => {
    if (!window.Capacitor || !window.Capacitor.Plugins.NativeBiometric) return;

    const { NativeBiometric } = window.Capacitor.Plugins;
    
    try {
        // This triggers the system fingerprint/FaceID UI
        await NativeBiometric.verifyIdentity({
            reason: "Log in to PayTrack",
            title: "Security Check",
            maxAvailableAuthentication: true,
            allowDeviceCredential: true 
        });

        // --- FIXED: REDIRECTION LOGIC ---
        // If the code reaches here, the fingerprint was accepted!
        colorDots('success'); 
        showFeedback("Identity Verified!", "success");
        
        // 1. Set the session to 'true' so dashboard allows entry
        sessionStorage.setItem(USER_SESSION_KEY, 'true');
        
        // 2. Redirect to dashboard
        setTimeout(() => {
            window.location.replace('dashboard.html');
        }, 500);

    } catch (err) {
        console.error("Biometric failed", err);
        // If user cancels or it fails, don't redirect, just show feedback
        showFeedback("Verification failed. Use PIN.", "error");
    }
};


    // --- PIN LOGIC ---
    const handleLogin = (enteredPin) => {
        const correctPin = localStorage.getItem(PIN_STORAGE_KEY);
        if (enteredPin === correctPin) {
            colorDots('success'); 
            showFeedback("Success!", "success");
            sessionStorage.setItem(USER_SESSION_KEY, 'true');
            setTimeout(() => window.location.replace('dashboard.html'), 500);
        } else {
            colorDots('error'); 
            failedAttempts++;
            if (failedAttempts >= MAX_ATTEMPTS) {
                shakeUI();
                setTimeout(() => { resetInput(); startLockout(); }, 500);
            } else {
                showFeedback(`Incorrect PIN (${failedAttempts}/${MAX_ATTEMPTS})`, "error");
                shakeUI();
                setTimeout(resetInput, 500);
            }
        }
    };

    const handleCreate = (enteredPin) => {
        tempPin = enteredPin;
        setMode('confirm');
    };

    const handleConfirm = (enteredPin) => {
        if (enteredPin === tempPin) {
            colorDots('success');
            localStorage.setItem(PIN_STORAGE_KEY, enteredPin);
            showFeedback("PIN Setup Complete", "success");
            setTimeout(() => {
                sessionStorage.setItem(USER_SESSION_KEY, 'true');
                window.location.replace('dashboard.html');
            }, 1000);
        } else {
            colorDots('error');
            showFeedback("PINs do not match", "error");
            shakeUI();
            setTimeout(() => { setMode('create'); tempPin = ''; }, 1000);
        }
    };

    const startLockout = () => {
        if (lockoutInterval) clearInterval(lockoutInterval);
        const keypadEl = document.getElementById('keypad');
        keypadEl.style.pointerEvents = 'none';
        keypadEl.style.opacity = '0.3'; 
        let seconds = LOCKOUT_DURATION;
        showFeedback(`Locked for ${seconds}s`, "error");

        lockoutInterval = setInterval(() => {
            seconds--;
            showFeedback(`Locked for ${seconds}s`, "error");
            if (seconds <= 0) {
                clearInterval(lockoutInterval);
                lockoutInterval = null; 
                keypadEl.style.pointerEvents = 'auto';
                keypadEl.style.opacity = '1';
                feedbackMessage.classList.add('hidden');
                failedAttempts = 0;
                resetInput();
            }
        }, 1000);
    };

    const triggerVisualPress = (key) => {
        let btn = key === 'delete' ? document.getElementById('deleteKey') : document.querySelector(`.key[data-value="${key}"]`);
        if (btn) {
            btn.classList.add('active-state'); 
            setTimeout(() => btn.classList.remove('active-state'), 150); 
        }
    };

    const handleKeypad = (key) => {
        if (isProcessing || lockoutInterval !== null) return;
        triggerVisualPress(key);
        const currentVal = pinInput.value;

        if (key === 'delete') {
            pinInput.value = currentVal.slice(0, -1);
            updateDots();
            resetDotColors();
            feedbackMessage.classList.add('hidden');
            return;
        }

        if (currentVal.length < 4) {
            pinInput.value += key;
            updateDots();
            if (pinInput.value.length === 4) {
                isProcessing = true;
                const finalPin = pinInput.value;
                setTimeout(() => {
                    if (mode === 'login') handleLogin(finalPin);
                    else if (mode === 'create') handleCreate(finalPin);
                    else if (mode === 'confirm') handleConfirm(finalPin);
                    // isProcessing is intentionally left true here. Each handler
                    // above schedules its own delayed UI reset (resetInput /
                    // setMode), and THOSE are what clear isProcessing. Clearing
                    // it here would let the keypad accept new digits before the
                    // previous PIN attempt has actually been cleared from
                    // pinInput, causing fast typing to silently lose input.
                }, 150);
            }
        }
    };

    keypad.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        if (btn.id === 'deleteKey') handleKeypad('delete');
        else handleKeypad(btn.dataset.value);
    });

    document.addEventListener('keydown', (e) => {
        if (e.key >= '0' && e.key <= '9') handleKeypad(e.key);
        if (e.key === 'Backspace') handleKeypad('delete');
    });

    initialize();
});