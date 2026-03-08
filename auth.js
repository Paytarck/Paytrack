// auth.js
import { db, doc, setDoc, getDoc, updateDoc, auth, googleProvider, signInWithPopup } from './firebase-config.js';

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

// --- FETCH DATA FROM CLOUD TO BROWSER ---
export async function downloadUserData(username) {
    const userRef = doc(db, "users", username);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
        const userData = userSnap.data();
        const appData = userData.data || {};

        if (appData.projects) localStorage.setItem('allTrackerProjects', JSON.stringify(appData.projects));
        if (appData.globalSettings) localStorage.setItem('dashboardGlobalSettings', JSON.stringify(appData.globalSettings));
        
        if (appData.projectDetails) {
            Object.keys(appData.projectDetails).forEach(key => {
                localStorage.setItem(key, appData.projectDetails[key]);
            });
        }
        console.log("Cloud data successfully downloaded to local storage.");
    }
}

export async function updateGlobalCard(project, projectData) {
    const user = auth.currentUser;
    const userId = user ? user.uid : 'anonymous';
    const cardNumber = generateCardNumber(project.id);
    const cardRef = doc(db, "global_cards", cardNumber);

    const payload = {
        cardNumber: cardNumber,
        cardName: project.name.toLowerCase(),
        originalName: project.name,
        projectId: project.id,
        ownerId: userId,
        updatedAt: new Date().toISOString(),
        fullData: projectData
    };

    try {
        await setDoc(cardRef, payload, { merge: true });
    } catch (e) {
        console.error("Error updating global card:", e);
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
        const fullData = { installment: JSON.parse(instData), expense: JSON.parse(expData), settings: JSON.parse(settings) };
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

        if (!userSnap.exists()) {
            const defaultHashedPin = await hashPin('0000');
            await setDoc(userRef, {
                username: username, email: user.email, displayName: user.displayName, phone: user.phoneNumber || "", pin: defaultHashedPin,
                authProvider: 'google', createdAt: new Date().toISOString(),
                data: { projects: [], settings: {}, globalSettings: {} }
            });
        }

        // UPDATED: Use localStorage for Username so it persists
        localStorage.setItem('paytrackUserSession', 'true');
        localStorage.setItem('paytrackUsername', username);
        
        await downloadUserData(username);
        await syncLocalCardsToCloud();
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
    
    // UPDATED: Use localStorage for Username so it persists
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

    // UPDATED: Use localStorage for Username so it persists
    localStorage.setItem('paytrackUserSession', 'true');
    localStorage.setItem('paytrackUsername', username);
    
    await downloadUserData(username);
    await syncLocalCardsToCloud();
    return true;
}

export async function syncDataToCloud() {
    // UPDATED: Check localStorage
    const username = localStorage.getItem('paytrackUsername');
    if (!username) return; 
    const userRef = doc(db, "users", username);
    const projects = JSON.parse(localStorage.getItem('allTrackerProjects')) || [];
    const globalSettings = JSON.parse(localStorage.getItem('dashboardGlobalSettings')) || {};
    const projectDetails = {};
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('project_')) projectDetails[key] = localStorage.getItem(key);
    }
    try {
        await updateDoc(userRef, { "data.projects": projects, "data.globalSettings": globalSettings, "data.projectDetails": projectDetails, lastSynced: new Date().toISOString() });
    } catch (error) { console.error("Sync failed:", error); }
}
import { onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- REAL-TIME LISTENER ---
export function subscribeToUserData(username, onUpdateCallback) {
    if (!username) return null;
    
    const userRef = doc(db, "users", username);
    
    // This function stays active as long as the tab is open
    return onSnapshot(userRef, (docSnap) => {
        if (docSnap.exists()) {
            const userData = docSnap.data();
            const appData = userData.data || {};

            // 1. Silently update LocalStorage so the app has the latest master data
            if (appData.projects) localStorage.setItem('allTrackerProjects', JSON.stringify(appData.projects));
            if (appData.globalSettings) localStorage.setItem('dashboardGlobalSettings', JSON.stringify(appData.globalSettings));
            
            if (appData.projectDetails) {
                Object.keys(appData.projectDetails).forEach(key => {
                    localStorage.setItem(key, appData.projectDetails[key]);
                });
            }

            // 2. Trigger the UI to re-render itself
            if (onUpdateCallback) onUpdateCallback(appData);
            console.log("Real-time sync: UI updated from cloud changes.");
        }
    });
}