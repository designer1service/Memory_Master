// ═══════════════════════════════════════════════════════════
// Memory Master — auth.js
// Firebase Auth: login, register, guest, logout, state listener
// ═══════════════════════════════════════════════════════════

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  getDocs,
  query,
  where,
  collection,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

import { auth, db }                               from './firebase.js?v=1779965816';
import { getState, setState }                     from './state_manager.js?v=1779965816';
import { showScreen, showToast, updateNavUser,
         setButtonLoading, showFormError,
         clearFormError, renderStats }            from './ui_manager.js?v=1779965816';
import { loadDashboard }                          from './dashboard.js?v=1779965816';

// ── Auth State Observer ────────────────────────────────────

export function initAuthObserver() {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      setState('user', user);
      setState('isGuest', false);
      await ensureUserDocs(user);
      await loadUserStats(user.uid);
      const usnap = await getDoc(doc(db, 'users', user.uid));
      const username = usnap.data()?.username || user.email?.split('@')[0] || 'Player';
      updateNavUser(username, false);
      loadDashboard();
      showScreen('dashboard');
      // Check for active multiplayer match to reconnect to (no localStorage needed)
      tryReconnectToMatch(user.uid);
    } else {
      if (!getState('isGuest')) {
        setState('user', null);
        showScreen('auth');
      }
    }
  });
}

// ── Reconnect to Active Match ───────────────────────────────
// Called on page load after auth resolves. Queries Firestore for any active
// multiplayer match that this user is part of, then rejoins automatically.
// Pure Firestore query — no localStorage/sessionStorage used.

async function tryReconnectToMatch(uid) {
  try {
    // Query multiplayer_index for all active rooms
    const indexQ = query(
      collection(db, 'multiplayer_index'),
      where('status', '==', 'active')
    );
    const indexSnap = await getDocs(indexQ);
    if (indexSnap.empty) return;

    const TWO_HOURS  = 2 * 60 * 60 * 1000;
    const FIVE_MINS  = 5 * 60 * 1000;

    for (const indexDoc of indexSnap.docs) {
      const matchId = indexDoc.data().match_id;
      if (!matchId) continue;

      const matchRef  = doc(db, 'games', 'multiplayer', matchId, 'data');
      const matchSnap = await getDoc(matchRef);
      if (!matchSnap.exists()) continue;

      const data = matchSnap.data();

      // Fix stale index entry if match is already over (use imported updateDoc)
      if (data.status !== 'active') {
        try { await updateDoc(indexDoc.ref, { status: data.status }); } catch (_) {}
        continue;
      }

      // Skip matches older than 2 hours (fully abandoned)
      const createdAt = data.created_at?.toMillis?.() ?? 0;
      if (createdAt > 0 && (Date.now() - createdAt) > TWO_HOURS) continue;

      // If turn_deadline passed more than 5 minutes ago, the match is
      // abandoned — close it out and fix the index, then skip reconnect.
      const deadline = data.turn_deadline ?? 0;
      if (deadline > 0 && (Date.now() - deadline) > FIVE_MINS) {
        try {
          await updateDoc(matchRef, { status: 'aborted', winner: null });
          await updateDoc(indexDoc.ref, { status: 'aborted' });
        } catch (_) {}
        continue;
      }

      const isP1 = data.player1?.uid === uid;
      const isP2 = data.player2?.uid === uid;
      if (!isP1 && !isP2) continue;

      // Found a valid active match — rejoin it
      console.log('[Reconnect] Rejoining match:', matchId);
      const { renderMultiplayerBoard, subscribeToMatch,
              startTurnCountdown, setLastSeen } =
        await import('./multiplayer.js?v=1779965816');

      setState('multiplayer', {
        matchId,
        roomCode:   data.room_code,
        isHost:     isP1,
        playerId:   uid,
        opponentId: isP1 ? data.player2?.uid : data.player1?.uid,
      });

      // Seed last-seen so handleMatchUpdate does not restart timer on
      // the very first onSnapshot after subscribing
      setLastSeen(data.current_turn, data.turn_deadline);

      renderMultiplayerBoard(data, uid, isP1);
      showScreen('multiplayer');
      subscribeToMatch(matchId);

      // Start countdown only if deadline hasn't expired yet (or <60s past)
      if (data.turn_deadline && (Date.now() - data.turn_deadline) < 60_000) {
        startTurnCountdown(data.current_turn, data.turn_deadline, matchId);
      }

      showToast('Reconnected to your match!', 'info', 3000);
      return;
    }
  } catch (e) {
    console.warn('[Reconnect] Failed:', e.message);
  }
}

// ── Ensure Firestore user + stats docs exist ───────────────

async function ensureUserDocs(user) {
  const userRef  = doc(db, 'users',  user.uid);
  const statsRef = doc(db, 'stats',  user.uid);

  const [usnap, ssnap] = await Promise.all([getDoc(userRef), getDoc(statsRef)]);

  if (!usnap.exists()) {
    await setDoc(userRef, {
      email:            user.email,
      username:         user.displayName || user.email?.split('@')[0] || 'Player',
      created_at:       serverTimestamp(),
      preferences:      { theme: 'default' },
    });
  }
  if (!ssnap.exists()) {
    await setDoc(statsRef, {
      total_matches:      0,
      wins:               0,
      losses:             0,
      best_times:         { easy: null, medium: null, hard: null, hardcore: null },
      multiplayer_rating: 1000,
    });
  }
}

// ── Load User Stats ────────────────────────────────────────

export async function loadUserStats(uid) {
  try {
    const ssnap = await getDoc(doc(db, 'stats', uid));
    if (ssnap.exists()) {
      setState('stats', ssnap.data());
      renderStats(getState('stats'));
    }
  } catch (e) {
    console.warn('Could not load stats:', e.message);
  }
}

// ── Login ──────────────────────────────────────────────────

export async function handleLogin() {
  const email    = document.getElementById('login-email')?.value?.trim();
  const password = document.getElementById('login-password')?.value;

  clearFormError('login-error');
  if (!email || !password) {
    showFormError('login-error', 'Please enter your email and password.');
    return;
  }

  setButtonLoading('btn-login', true);
  try {
    await signInWithEmailAndPassword(auth, email, password);
    // onAuthStateChanged handles navigation
  } catch (e) {
    setButtonLoading('btn-login', false);
    showFormError('login-error', friendlyAuthError(e.code));
  }
}

// ── Register ───────────────────────────────────────────────

export async function handleRegister() {
  const username = document.getElementById('reg-username')?.value?.trim();
  const email    = document.getElementById('reg-email')?.value?.trim();
  const password = document.getElementById('reg-password')?.value;
  const confirm  = document.getElementById('reg-password-confirm')?.value;

  clearFormError('register-error');
  if (!username || username.length < 2) {
    showFormError('register-error', 'Username must be at least 2 characters.');
    return;
  }
  if (!email) {
    showFormError('register-error', 'Please enter a valid email.');
    return;
  }
  if (!password || password.length < 6) {
    showFormError('register-error', 'Password must be at least 6 characters.');
    return;
  }
  if (password !== confirm) {
    showFormError('register-error', 'Passwords do not match.');
    return;
  }

  setButtonLoading('btn-register', true);
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    // Write username immediately (ensureUserDocs would overwrite with email-based name)
    await setDoc(doc(db, 'users', cred.user.uid), {
      email,
      username,
      created_at: serverTimestamp(),
      preferences: { theme: 'default' },
    });
    await setDoc(doc(db, 'stats', cred.user.uid), {
      total_matches:      0,
      wins:               0,
      losses:             0,
      best_times:         { easy: null, medium: null, hard: null, hardcore: null },
      multiplayer_rating: 1000,
    });
    setState('user', cred.user);
    updateNavUser(username, false);
    loadDashboard();
    showScreen('dashboard');
  } catch (e) {
    setButtonLoading('btn-register', false);
    showFormError('register-error', friendlyAuthError(e.code));
  }
}

// ── Guest ──────────────────────────────────────────────────

export function handleGuest() {
  const name = (document.getElementById('guest-name')?.value?.trim()) || 'GuestPlayer';
  setState('isGuest', true);
  setState('guestName', name);
  setState('user', null);
  updateNavUser(name, true);
  loadDashboard();
  showScreen('dashboard');
}

// ── Logout ─────────────────────────────────────────────────

export async function handleLogout() {
  try {
    await signOut(auth);
    setState('user', null);
    setState('isGuest', false);
    setState('guestName', '');
    showScreen('auth');
  } catch (e) {
    showToast('Could not sign out. Try again.', 'error');
  }
}

// ── Error Messages ─────────────────────────────────────────

function friendlyAuthError(code) {
  const map = {
    'auth/user-not-found':       'No account found with that email.',
    'auth/wrong-password':       'Incorrect password.',
    'auth/email-already-in-use': 'An account with that email already exists.',
    'auth/invalid-email':        'Please enter a valid email address.',
    'auth/weak-password':        'Password must be at least 6 characters.',
    'auth/too-many-requests':    'Too many attempts. Please wait before trying again.',
    'auth/network-request-failed': 'Network error. Check your connection.',
    'auth/invalid-credential':   'Invalid email or password.',
  };
  return map[code] || 'An error occurred. Please try again.';
}
