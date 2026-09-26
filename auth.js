// --- auth.js (CLEANED & FIXED) ---
import { db, doc, setDoc, getDoc, updateDoc, auth, googleProvider, signInWithPopup } from './firebase-config.js';
import { onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { collection, addDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- OFFLINE-HANG PROTECTION ---
// The Firestore Web SDK has a well-documented behavior where an awaited
// write (setDoc/updateDoc/addDoc) never resolves OR rejects while the
// device is offline — the write is still applied to Firestore's local
// cache and will sync to the server automatically once connectivity
// returns, but the Promise itself just hangs forever instead of failing
// fast. (https://github.com/firebase/firebase-js-sdk/issues/8657)
// getDoc() is unaffected by this and needs no wrapping.
//
// Racing a timeout against the write (below) stops OUR code from waiting
// forever, but the underlying network request Firestore started is still
// left running in the background indefinitely — anything else that tracks
// raw network activity (a global loading indicator, dev tools, etc.) can
// still look "stuck" even after our own code has moved on. So both helpers
// below check navigator.onLine FIRST and skip starting the write at all
// when we already know we're offline — the write function passed in is
// only invoked once we're reasonably sure it has a network to try.

// For best-effort background syncs where the caller already treats
// failure as "fine, we'll catch up later": if offline, don't even start
// the write. If online, give up waiting after `ms` and let the caller
// carry on as if it finished — the write is already safely queued in
// Firestore's local cache and will reach the server on its own.
//
// `makeWrite` is a function that RETURNS the write promise (e.g.
// `() => setDoc(ref, data)`) rather than the promise itself, so we can
// avoid ever calling it while offline.
function withTimeout(makeWrite, ms = 6000) {
    if (!navigator.onLine) return Promise.resolve();
    return Promise.race([
        Promise.resolve(makeWrite()),
        new Promise(resolve => setTimeout(resolve, ms))
    ]);
}

// For writes the caller genuinely needs an honest outcome for (creating an
// account, logging in, changing a PIN): if offline, reject immediately
// with a clear message instead of even trying. If online but the write
// doesn't settle within `ms`, reject with a timeout error — either way the
// caller's existing "offline / failed" handling actually runs instead of
// hanging forever with no feedback at all.
function withTimeoutStrict(makeWrite, ms = 8000) {
    if (!navigator.onLine) return Promise.reject(new Error("You're offline. Check your internet connection."));
    return Promise.race([
        Promise.resolve(makeWrite()),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Request timed out. Check your internet connection.')), ms))
    ]);
}

export async function submitFeedbackToCloud(feedbackData) {
    try {
        const feedbackRef = collection(db, "feedback");
        await withTimeoutStrict(() => addDoc(feedbackRef, {
            ...feedbackData,
            timestamp: new Date().toISOString(),
            status: "unread" // Useful for you to track which ones you've seen
        }));
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
    const userRef = doc(db, "users", username); 
    try {
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
            const cloudData = userSnap.data().data; // Get the data from Firebase
            
            // CRITICAL: Actually save it to the new phone's local storage
            if (cloudData && cloudData.projects) {
                localStorage.setItem('allTrackerProjects', JSON.stringify(cloudData.projects));
            }
            if (cloudData && cloudData.globalSettings) {
                localStorage.setItem('dashboardGlobalSettings', JSON.stringify(cloudData.globalSettings));
            }
            return true;
        }
    } catch (e) {
        console.error("Download Error:", e);
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

    // ownerUsername is stored at the top level of the card document so that
    // anyone who imports this card can see WHO originally created it.
    const ownerUsername = project.ownerUsername || localStorage.getItem('paytrackUsername') || null;

    const payload = {
        projectId: project.id,
        cardName: project.name.trim().toLowerCase(), 
        originalName: project.name,
        ownerUsername: ownerUsername,
        projectType: project.type || null,
        updatedAt: new Date().toISOString(),
        lastUpdated: projectData.lastUpdated || Date.now(), 
        fullData: projectData 
    };

    try {
        // merge: true is important here — it stops a routine data sync from wiping out
        // other fields on the card document that aren't part of this payload.
        await withTimeout(() => setDoc(cardRef, payload, { merge: true }));
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
        if (data.cardName === cleanName) {
            return data;
        }
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
            await withTimeoutStrict(() => setDoc(userRef, {
                username: username, email: user.email, displayName: user.displayName,
                authProvider: 'google', createdAt: new Date().toISOString(),
                activeDevices: [deviceId], // Add first device
                data: { projects: [], settings: {}, globalSettings: {} }
            }));
        } else {
            // Existing user: record this device if it isn't already known.
            // No cap on how many devices can be active at once — the account
            // can be logged into from as many devices as the person wants.
            const userData = userSnap.data();
            let activeDevices = userData.activeDevices || [];

            if (!activeDevices.includes(deviceId)) {
                activeDevices.push(deviceId);
                await withTimeoutStrict(() => updateDoc(userRef, { activeDevices: activeDevices }));
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
    await withTimeoutStrict(() => setDoc(userRef, {
        username, email, phone, pin: hashedPin, authProvider: 'local', createdAt: new Date().toISOString(),
        data: { projects: [], settings: {}, globalSettings: {} }
    }));
    localStorage.setItem('paytrackUserSession', 'true');
    localStorage.setItem('paytrackUsername', username);
    return true;
}

// Changes the PIN on the CLOUD ACCOUNT itself — the one used to log into
// this account from login.html on another device. This is intentionally
// separate from the local device PIN (settings.js's "Change PIN" only
// touches dashboardDeletePassword, never this). Not currently called from
// anywhere in this app — kept here for a future dedicated "change account
// PIN" screen. If you build one, remember to prompt for the CURRENT
// account PIN and verify it (e.g. re-run loginUser) before calling this,
// the same way handlePasswordUpdate verifies the current local PIN.
export async function updateAccountPin(newPin) {
    const username = localStorage.getItem('paytrackUsername');
    if (!username) return;
    const hashedPin = await hashPin(newPin);
    const userRef = doc(db, "users", username);
    await withTimeoutStrict(() => updateDoc(userRef, { pin: hashedPin }));
}

export async function loginUser(username, pin) {
    const userRef = doc(db, "users", username);
    const userSnap = await getDoc(userRef);
    
    if (!userSnap.exists()) throw new Error("Username not found.");
    
    const userData = userSnap.data();
    const hashedPin = await hashPin(pin);
    if (userData.pin !== hashedPin) throw new Error("Incorrect PIN.");

    // Record this device as active. No cap on the number of devices — the
    // account can be logged into anywhere, on as many devices as wanted.
    const deviceId = getOrCreateDeviceId();
    let activeDevices = userData.activeDevices || [];

    if (!activeDevices.includes(deviceId)) {
        activeDevices.push(deviceId);
        await withTimeoutStrict(() => updateDoc(userRef, { activeDevices: activeDevices }));
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
        await withTimeout(() => updateDoc(userRef, { 
            "data.projects": localProjects, 
            "data.globalSettings": globalSettings, 
            lastSynced: new Date().toISOString() 
        }));
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
                await withTimeout(() => updateDoc(userRef, { activeDevices: updatedDevices }));
                console.log("Device removed from cloud.");
            }
        } catch (e) {
            console.error("Logout Cloud Error:", e);
        }
    }

    // 2. Clear ALL local data EXCEPT device-level settings that have nothing
    // to do with which account is logged in. In particular, the local
    // app-lock PIN (dashboardDeletePassword) is created once, the very
    // first time this device is ever set up, and is intentionally
    // independent of any account — logging out (or into a different
    // account later) must never force it to be created again.
    const keysToKeep = ['paytrackDeviceId', 'dashboardDeletePassword'];
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
        await withTimeoutStrict(() => updateDoc(userRef, { activeDevices: [] }));
        console.log("All device sessions cleared in cloud.");
        return true;
    } catch (e) {
        console.error("Session Reset Error:", e);
        throw e;
    }
}