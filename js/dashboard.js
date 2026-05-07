// ═══════════════════════════════════════════════════════════
// Memory Master — dashboard.js
// Dashboard data loading, stats, leaderboard, game result persistence
// ═══════════════════════════════════════════════════════════

import {
  doc, getDoc, getDocs, setDoc, updateDoc,
  collection, query, orderBy, limit,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

import { db }                             from './firebase.js?v=1778189194';
import { getState, setState }             from './state_manager.js?v=1778189194';
import { renderStats, renderLeaderboard, showToast } from './ui_manager.js?v=1778189194';

// ── Load full dashboard data ───────────────────────────────

export async function loadDashboard() {
  const user = getState('user');

  if (user) {
    // Load stats
    try {
      const ssnap = await getDoc(doc(db, 'stats', user.uid));
      if (ssnap.exists()) {
        setState('stats', ssnap.data());
        renderStats(getState('stats'));
      }
    } catch(e) { console.warn('Stats load failed:', e.message); }
  }

  // Load leaderboard (top 10 by wins, accessible to all)
  loadLeaderboard();
}

// ── Leaderboard ────────────────────────────────────────────

async function loadLeaderboard() {
  const list = document.getElementById('leaderboard-list');
  if (list) {
    list.innerHTML = `
      <div class="leaderboard-loading">
        <span class="loading-dot"></span>
        <span class="loading-dot"></span>
        <span class="loading-dot"></span>
      </div>`;
  }

  try {
    const q = query(
      collection(db, 'stats'),
      orderBy('wins', 'desc'),
      limit(10)
    );
    const snap  = await getDocs(q);
    const uids  = snap.docs.map(d => d.id);

    // Fetch usernames in parallel
    const userSnaps = await Promise.all(
      uids.map(uid => getDoc(doc(db, 'users', uid)))
    );

    const entries = snap.docs.map((d, i) => ({
      uid:                uids[i],
      username:           userSnaps[i]?.data()?.username || 'Player',
      wins:               d.data().wins               || 0,
      multiplayer_rating: d.data().multiplayer_rating || 1000,
    }));

    const currentUid = getState('user')?.uid;
    const { renderLeaderboard: render } = await import('./ui_manager.js?v=1778189194');
    render(entries, currentUid);

    if (window.lucide) window.lucide.createIcons();
  } catch(e) {
    console.warn('Leaderboard load failed:', e.message);
    if (list) list.innerHTML = '<div class="leaderboard-empty">Could not load leaderboard.</div>';
  }
}

// ── Save Game Result ───────────────────────────────────────

/**
 * Save singleplayer result to stats/{uid}.
 * Returns true if a new best time was set.
 * @param {{ mode, time, moves, pairs, win }} result
 */
export async function saveGameResult({ mode, time, moves, pairs, win }) {
  const user = getState('user');
  if (!user) return false;

  const statsRef = doc(db, 'stats', user.uid);
  let isNewBest  = false;

  try {
    const snap   = await getDoc(statsRef);
    const data   = snap.exists() ? snap.data() : {
      total_matches: 0, wins: 0, losses: 0,
      best_times: { easy: null, medium: null, hard: null, hardcore: null },
      multiplayer_rating: 1000,
    };

    const newData = {
      total_matches: (data.total_matches || 0) + 1,
      wins:          (data.wins   || 0) + (win ? 1 : 0),
      losses:        (data.losses || 0) + (win ? 0 : 1),
    };

    // Best time (only for non-endless, only on win)
    const bt = { ...(data.best_times || {}) };
    if (win && mode !== 'endless') {
      const prev = bt[mode];
      if (prev === null || prev === undefined || time < prev) {
        bt[mode]   = time;
        isNewBest  = true;
      }
    }
    newData.best_times = bt;

    if (snap.exists()) {
      await updateDoc(statsRef, newData);
    } else {
      await setDoc(statsRef, { ...data, ...newData });
    }

    // Update local state
    setState('stats', { ...data, ...newData });
    renderStats(getState('stats'));

  } catch(e) {
    console.warn('Could not save game result:', e.message);
  }

  return isNewBest;
}

// ── Update Multiplayer Rating ──────────────────────────────

export async function updateMultiplayerRating(win) {
  const user = getState('user');
  if (!user) return;

  const statsRef = doc(db, 'stats', user.uid);
  try {
    const snap = await getDoc(statsRef);
    if (!snap.exists()) return;
    const current = snap.data().multiplayer_rating || 1000;
    const delta   = win ? 25 : -20;
    const newRating = Math.max(0, current + delta);
    await updateDoc(statsRef, {
      multiplayer_rating: newRating,
      wins:    snap.data().wins    + (win ? 1 : 0),
      losses:  snap.data().losses  + (win ? 0 : 1),
      total_matches: snap.data().total_matches + 1,
    });
    setState('stats.multiplayer_rating', newRating);
  } catch(e) {
    console.warn('Rating update failed:', e.message);
  }
}
