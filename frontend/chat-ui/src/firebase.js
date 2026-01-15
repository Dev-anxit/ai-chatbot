import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCTS2UGAjLvEczMpzUUgpMWsmvgGs-nqW0",
  authDomain: "ehan-ai.firebaseapp.com",
  projectId: "ehan-ai",
  storageBucket: "ehan-ai.firebasestorage.app",
  messagingSenderId: "126129835639",
  appId: "1:126129835639:web:66919b99d7e95b45ca0072"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// ✅ EXPORT THESE (this was missing)
export const auth = getAuth(app);
export const db = getFirestore(app);
