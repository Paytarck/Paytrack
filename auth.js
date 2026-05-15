// --- auth.js (CLEANED & FIXED) ---
import { db, doc, setDoc, getDoc, updateDoc, auth, googleProvider, signInWithPopup } from './firebase-config.js';
import { onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { collection, addDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

export async function submitFeedbackToCloud(feedbackData) {
    try {
        const feedbackRef = collection(db, "feedback");
        await addDoc(feedbackRef, {
            ...feedbackData,
            timestamp: new Date().toISOString(),
            status: "unread" // Useful for you to track which ones you've seen
        });
        return true;
    } catch (e) {
        console.error("Feedback Error:", e);
        throw e;
    }
}

function getOrCreateDeviceId() {
    let deviceId = localStorage.getItem('paytrackDeviceId');
    if (!deviceId) {
        // Generate a simple unique ID for this installation
        deviceId = 'dev_' + Math.random().toString(36).substr(2, 9) + Date.now();
        localStorage.setItem('paytrackDeviceId', deviceId);
    }
    return deviceId;
}

async function hashPin(pin) {
    const msgBuffer = new TextEncoder().encode(pin);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export function generateCardNumber(projectId) {
    const seed = parseInt(projectId, 10);
    const part1 = (seed % 9000) + 1000;
    const part2 = ((seed * 3) % 9000) + 1000;
    const part3 = ((seed * 7) % 9000) + 1000;
    const part4 = ((seed * 11) % 9000) + 1000;
    return `${part1}${part2}${part3}${part4}`;
}

export function subscribeToProjectCard(cardNumber, onUpdateCallback) {
    if (!cardNumber) return null;
    const cleanNumber = cardNumber.replace(/\s+/g, '');
    const cardRef = doc(db, "global_cards", cleanNumber);

    return onSnapshot(cardRef, { includeMetadataChanges: true }, (docSnap) => {
        // If we are currently writing to the cloud from THIS device, don't let the 
        // cloud echo back and overwrite our UI.
        if (docSnap.metadata.hasPendingWrites) return; 

        if (docSnap.exists()) {
            const data = docSnap.data();
            // ONLY trigger callback if there is actually data inside
            if (data && data.fullData && onUpdateCallback) {
                onUpdateCallback(data.fullData);
            }
        }
    });
}

// --- FETCH DATA FROM CLOUD TO BROWSER ---
export async function downloadUserData(username) {
    if (!username) return;
    // Ensure "users" here matches the collection name in your Firebase exactly
    const userRef = doc(db, "users", username); 
    try {
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
            // ... your existing logic
            return true;
        }
    } catch (e) {
        console.error("Login Download Error:", e);
        throw e; // This will show the permission error in the console
    }
    return false;
}

export async function downloadProjectData(cardNumber) {
    if (!cardNumber) return null;
    const cardRef = doc(db, "global_cards", cardNumber.replace(/\s+/g, ''));
    const docSnap = await getDoc(cardRef);
    if (docSnap.exists()) {
        return docSnap.data().fullData;
    }
    return null;
}

export async function updateGlobalCard(project, projectData) {
    if (!project || !project.id) return;
    const cardNumber = project.cardNumber ? project.cardNumber.replace(/\s+/g, '') : generateCardNumber(project.id);
    const cardRef = doc(db, "global_cards", cardNumber);

    const payload = {
        projectId: project.id,
        cardName: project.name.trim().toLowerCase(), 
        originalName: project.name,
        updatedAt: new Date().toISOString(),
        lastUpdated: projectData.lastUpdated || Date.now(), 
        fullData: projectData 
    };

    try {
        await setDoc(cardRef, payload); 
    } catch (e) {
        console.error("🔥 CLOUD ERROR:", e);
        if (e.message.includes('too large')) {
            alert("Sync Failed: You have added too many images or they are too large. Try removing some receipts.");
        }
    }
}

export async function fetchProjectByCard(cardNumberStr, cardNameStr) {
    const cleanNumber = cardNumberStr.replace(/\s+/g, '');
    const cleanName = cardNameStr.trim().toLowerCase();
    const cardRef = doc(db, "global_cards", cleanNumber);
    const docSnap = await getDoc(cardRef);
    if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.cardName === cleanName) return data;
        else throw new Error("Card Name does not match.");
    } else throw new Error("Card Number not found.");
}

export async function syncLocalCardsToCloud() {
    const projects = JSON.parse(localStorage.getItem('allTrackerProjects')) || [];
    for (const p of projects) {
        const instData = localStorage.getItem(`project_${p.id}_installment`);
        const expData = localStorage.getItem(`project_${p.id}_expense`);
        const settings = localStorage.getItem(`project_${p.id}_settings`);
        
        const fullData = { 
            installment: instData ? JSON.parse(instData) : null, 
            expense: expData ? JSON.parse(expData) : null, 
            settings: settings ? JSON.parse(settings) : null 
        };
        await updateGlobalCard(p, fullData);
    }
}

export async function handleGoogleAuth() {
    try {
        const result = await signInWithPopup(auth, googleProvider);
        const user = result.user;
        const username = user.email.replace(/[@.]/g, '_'); 
        const userRef = doc(db, "users", username);
        const userSnap = await getDoc(userRef);
        const deviceId = getOrCreateDeviceId();

        if (!userSnap.exists()) {
            // New User: Register with this device
            await setDoc(userRef, {
                username: username, email: user.email, displayName: user.displayName,
                authProvider: 'google', createdAt: new Date().toISOString(),
                activeDevices: [deviceId], // Add first device
                data: { projects: [], settings: {}, globalSettings: {} }
            });
        } else {
            // Existing User: Check Device Limit
            const userData = userSnap.data();
            let activeDevices = userData.activeDevices || [];

            if (!activeDevices.includes(deviceId)) {
                if (activeDevices.length >= 2) {
                    throw new Error("This account is already active on 2 other devices.");
                }
                activeDevices.push(deviceId);
                await updateDoc(userRef, { activeDevices: activeDevices });
            }
        }

        localStorage.setItem('paytrackUserSession', 'true');
        localStorage.setItem('paytrackUsername', username);
        await downloadUserData(username);
        return true;
    } catch (error) { throw error; }
}

export async function registerUser(username, email, phone, pin) {
    const userRef = doc(db, "users", username);
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) throw new Error("Username taken.");
    const hashedPin = await hashPin(pin);
    await setDoc(userRef, {
        username, email, phone, pin: hashedPin, authProvider: 'local', createdAt: new Date().toISOString(),
        data: { projects: [], settings: {}, globalSettings: {} }
    });
    localStorage.setItem('paytrackUserSession', 'true');
    localStorage.setItem('paytrackUsername', username);
    return true;
}

export async function loginUser(username, pin) {
    const userRef = doc(db, "users", username);
    const userSnap = await getDoc(userRef);
    
    if (!userSnap.exists()) throw new Error("Username not found.");
    
    const userData = userSnap.data();
    const hashedPin = await hashPin(pin);
    if (userData.pin !== hashedPin) throw new Error("Incorrect PIN.");

    // --- DEVICE LIMIT CHECK ---
    const deviceId = getOrCreateDeviceId();
    let activeDevices = userData.activeDevices || [];

    // If this specific device is NOT already logged in
    if (!activeDevices.includes(deviceId)) {
        if (activeDevices.length >= 2) {
            throw new Error("Login Limit Reached: This account is already logged into 2 devices. Please logout from one to continue.");
        }
        // Add this device to the list
        activeDevices.push(deviceId);
        await updateDoc(userRef, { activeDevices: activeDevices });
    }

    localStorage.setItem('paytrackUserSession', 'true');
    localStorage.setItem('paytrackUsername', username);
    await downloadUserData(username);
    return true;
}

export async function syncDataToCloud() {
    const username = localStorage.getItem('paytrackUsername');
    if (!username) return; 

    const userRef = doc(db, "users", username);
    const localProjects = JSON.parse(localStorage.getItem('allTrackerProjects')) || [];
    const globalSettings = JSON.parse(localStorage.getItem('dashboardGlobalSettings')) || {};

    try {
        // WE REMOVED projectDetails FROM HERE. 
        // We only sync the list of projects and the main settings.
        await updateDoc(userRef, { 
            "data.projects": localProjects, 
            "data.globalSettings": globalSettings, 
            lastSynced: new Date().toISOString() 
        });
    } catch (error) { console.error("Sync failed:", error); }
}

// auth.js - UPDATE THIS FUNCTION
export function subscribeToUserData(username, onUpdateCallback) {
    if (!username) return null;
    const userRef = doc(db, "users", username);
    
    // CRITICAL FIX: Add { includeMetadataChanges: true }
    return onSnapshot(userRef, { includeMetadataChanges: true }, (docSnap) => {
        // Don't overwrite local dashboard data with "stale" cloud data while syncing
        if (docSnap.metadata.hasPendingWrites) return; 

        if (docSnap.exists()) {
            const userData = docSnap.data();
            const appData = userData.data || {};

            if (appData.projects) localStorage.setItem('allTrackerProjects', JSON.stringify(appData.projects));
            if (appData.globalSettings) localStorage.setItem('dashboardGlobalSettings', JSON.stringify(appData.globalSettings));
            
            if (onUpdateCallback) onUpdateCallback(appData);
        }
    });
}

export async function logoutUser() {
    const username = localStorage.getItem('paytrackUsername');
    const deviceId = localStorage.getItem('paytrackDeviceId');

    // 1. Remove device from Cloud first so another device can log in
    if (username && deviceId) {
        try {
            const userRef = doc(db, "users", username);
            const userSnap = await getDoc(userRef);
            if (userSnap.exists()) {
                const currentDevices = userSnap.data().activeDevices || [];
                const updatedDevices = currentDevices.filter(id => id !== deviceId);
                await updateDoc(userRef, { activeDevices: updatedDevices });
                console.log("Device removed from cloud.");
            }
        } catch (e) {
            console.error("Logout Cloud Error:", e);
        }
    }

    // 2. Clear ALL local data
    const keysToKeep = ['paytrackDeviceId']; // Keep DeviceID so we don't generate new ones every time
    const allKeys = Object.keys(localStorage);
    
    allKeys.forEach(key => {
        if (!keysToKeep.includes(key)) {
            localStorage.removeItem(key);
        }
    });

    sessionStorage.clear();
    
    // 3. Redirect to login
    window.location.replace('login.html');
}

// auth.js - Add this new function
export async function clearAllDeviceSessions(username) {
    const userRef = doc(db, "users", username);
    try {
        // Force the activeDevices array to be empty in the cloud
        await updateDoc(userRef, { activeDevices: [] });
        console.log("All device sessions cleared in cloud.");
        return true;
    } catch (e) {
        console.error("Session Reset Error:", e);
        throw e;
    }
}