// firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// REPLACE THIS WITH YOUR ACTUAL FIREBASE CONFIG FROM CONSOLE
const firebaseConfig = {
  apiKey: "AIzaSyA_9r8nwNiNaQvFo3nNx_JPku-b8v1fwUY", 
  authDomain: "pay-track-fb184.firebaseapp.com",
  projectId: "pay-track-fb184",
  storageBucket: "pay-track-fb184.firebasestorage.app",
  messagingSenderId: "35957168757",
  appId: "1:35957168757:web:8f3cfc6db2c1c5dcfab63c",
  measurementId: "G-ZKDEKJZHBJ"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

import { enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Enable offline persistence (fixes the laptop transport error)
enableIndexedDbPersistence(db).catch((err) => {
    if (err.code == 'failed-precondition') {
        console.warn("Multiple tabs open, persistence can only be enabled in one tab at a time.");
    } else if (err.code == 'unimplemented') {
        console.warn("The current browser does not support all of the features needed to enable persistence.");
    }
});

export { db, doc, setDoc, getDoc, updateDoc, auth, googleProvider, signInWithPopup };