// ═══════════════════════════════════════════════════════════
// Memory Master — firebase.js
// Firebase initialization and exports
// ═══════════════════════════════════════════════════════════

import { initializeApp }          from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import { getAuth }                from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import { getFirestore }           from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey:            "AIzaSyCPhtVLM656_yE0ZBYX2yU7yCZ1Nm_-MrM",
  authDomain:        "memory-master-a7213.firebaseapp.com",
  projectId:         "memory-master-a7213",
  storageBucket:     "memory-master-a7213.firebasestorage.app",
  messagingSenderId: "956893462214",
  appId:             "1:956893462214:web:76bf3824fa042d6974e1c7"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db   = getFirestore(app);
