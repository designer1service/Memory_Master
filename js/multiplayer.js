// ═══════════════════════════════════════════════════════════
// Memory Master — multiplayer.js
// 1v1 real-time multiplayer: room creation, joining,
// turn management, HP system, abilities, onSnapshot sync
// ═══════════════════════════════════════════════════════════

import {
  doc, getDoc, setDoc, updateDoc, onSnapshot,
  serverTimestamp, collection,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import {
  query, where, getDocs,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

import { db, auth }                                  from './firebase.js?v=1778595091';
import { getState, setState, resetMultiplayerState } from './state_manager.js?v=1778595091';
import { generateBoard }                             from './game_logic.js?v=1778595091';
import {
  showScreen, showToast, updateHPBar,
  updateTurnIndicator, showAbilityToast,
  showResults, showCoinFlip, renderAbilityLog,
} from './ui_manager.js?v=1778595091';
import { updateMultiplayerRating }                   from './dashboard.js?v=1778595091';

// ── Ability definitions ────────────────────────────────────
const ABILITIES = ['damage','heal','extra_turn','reveal_card'];
function getAbilityForPair(pairIndex) {
  return ABILITIES[pairIndex % ABILITIES.length];
}

// ── Generate Room Code ─────────────────────────────────────
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ── Create Room ────────────────────────────────────────────
export async function createRoom() {
  const user = getState('user');
  if (!user) { showToast('You must be signed in to play multiplayer.', 'error'); return; }

  const code    = generateRoomCode();
  const matchId = `mp_${code}_${Date.now()}`;
  const cards   = generateBoard('medium');

  const usnap    = await getDoc(doc(db, 'users', user.uid));
  const username = usnap.data()?.username || user.email?.split('@')[0] || 'Player';

  // Randomly shuffle abilities across pairs so the order is never predictable
  const _abilityPool = ['damage','heal','extra_turn','reveal_card'];
  function _shuffleArr(a) {
    const r = [...a];
    for (let i = r.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [r[i], r[j]] = [r[j], r[i]];
    }
    return r;
  }
  const totalPairs = cards.length / 2;
  // Build pair_abilities: cycle through shuffled pool
  const pair_abilities = Array.from({ length: totalPairs }, (_, i) => {
    return _shuffleArr(_abilityPool)[i % _abilityPool.length];
  });

  const matchData = {
    status:    'waiting',
    room_code: code,
    player1:   { uid: user.uid, username, hp: 100 },
    player2:          null,
    current_turn:     user.uid,
    board_state:      cards.map(c => ({ icon: c.icon, matched: false })),
    winner:           null,
    last_action_timestamp: serverTimestamp(),
    created_at:       serverTimestamp(),
    pairs_found:      0,
    total_pairs:      totalPairs,
    flipped:          [],
    showing:          [],
    pair_abilities,
    ability_log:      [],
    player1_moves:    0,
    player2_moves:    0,
    match_start_time: Date.now(),
    turn_deadline:    null,
    resolve_at:       null,
  };

  await setDoc(doc(db, 'games', 'multiplayer', matchId, 'data'), matchData);

  await setDoc(doc(db, 'multiplayer_index', matchId), {
    match_id: matchId, room_code: code, status: 'waiting',
    created_by: user.uid, created_at: serverTimestamp(),
  });

  setState('multiplayer', { matchId, roomCode: code, isHost: true, playerId: user.uid });

  const { showRoomCode } = await import('./ui_manager.js?v=1778595091');
  showRoomCode(code);
  subscribeToMatch(matchId);
}

// ── Join Room ──────────────────────────────────────────────
export async function joinRoom(code) {
  const user = getState('user');
  if (!user) { showToast('You must be signed in to play multiplayer.', 'error'); return; }

  const normalised = code.trim().toUpperCase();
  if (normalised.length !== 6) { return 'invalid'; }

  // Query multiplayer_index by room_code only (single-field, no composite index needed)
  const indexQ = query(
    collection(db, 'multiplayer_index'),
    where('room_code', '==', normalised)
  );

  let matchId = null;
  try {
    const snap = await getDocs(indexQ);
    if (snap.empty) return 'not_found';
    const waitingDoc = snap.docs.find(d => d.data().status === 'waiting');
    if (!waitingDoc) return 'not_found';
    matchId = waitingDoc.data().match_id;
  } catch(e) {
    console.error('joinRoom index query failed:', e);
    return 'not_found';
  }

  const matchRef = doc(db, 'games', 'multiplayer', matchId, 'data');
  const msnap    = await getDoc(matchRef);
  if (!msnap.exists() || msnap.data().status !== 'waiting') return 'not_found';

  const mdata = msnap.data();
  if (mdata.player1.uid === user.uid) return 'same_player';

  const usnap    = await getDoc(doc(db, 'users', user.uid));
  const username = usnap.data()?.username || user.email?.split('@')[0] || 'Player';

  // Set game active + coin flip + first turn — all in ONE write to avoid race conditions
  const coinWinner = Math.random() < 0.5 ? mdata.player1.uid : user.uid;
  const deadlineMs = Date.now() + 30_000;
  await updateDoc(matchRef, {
    status:        'active',
    player2:       { uid: user.uid, username, hp: 100 },
    current_turn:  coinWinner,
    first_turn:    coinWinner,
    turn_deadline: deadlineMs,
    last_action_timestamp: serverTimestamp(),
  });

  // Update index
  try {
    await updateDoc(doc(db, 'multiplayer_index', matchId), { status: 'active' });
  } catch(e) { /* non-critical */ }

  setState('multiplayer', {
    matchId,
    roomCode: normalised,
    isHost:   false,
    playerId: user.uid,
    opponentId: mdata.player1.uid,
  });

  // Fetch fresh data (now has player2 + coin winner) and show coin flip
  const freshSnap = await getDoc(matchRef);
  const freshData = freshSnap.data();

  const usnap2    = await getDoc(doc(db, 'users', user.uid));
  const myName    = usnap2.data()?.username || user.email?.split('@')[0] || 'You';
  const oppName   = mdata.player1.username || 'Opponent';
  const iGoFirst  = coinWinner === user.uid;

  _coinFlipShown = true; // prevent handleMatchUpdate from showing coin flip again
  renderMultiplayerBoard(freshData, user.uid, false);
  showScreen('multiplayer');
  await showCoinFlip(myName, oppName, iGoFirst);

  // Start 30s turn countdown
  startTurnCountdown(freshData.current_turn, freshData.turn_deadline, matchId);

  subscribeToMatch(matchId);
  return 'ok';
}

// ── Host Polling Fallback ─────────────────────────────────
// Removed: host now relies entirely on onSnapshot (handleMatchUpdate)
// to detect when player2 joins and transition to active state.
// This eliminates the race condition where polling + onSnapshot both
// tried to show the coin flip / render the board simultaneously.

// ── Subscribe to Match ─────────────────────────────────────
export function subscribeToMatch(matchId) {
  const ref = doc(db, 'games', 'multiplayer', matchId, 'data');

  const unsubscribe = onSnapshot(ref, (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    handleMatchUpdate(data, matchId);
  });

  setState('multiplayer', { unsubscribe });
}

// ── Handle Match Update ────────────────────────────────────
// Track last seen turn+deadline so the timer is only restarted when the
// turn actually changes — not on every card-flip onSnapshot.
let _lastSeenTurn     = null;
let _lastSeenDeadline = null;
let _coinFlipShown    = false; // prevent duplicate coin flip on host side
let _matchEndedId     = null;  // prevent handleMatchEnd firing twice for same match

// Exported so auth.js can seed these values on reconnect before onSnapshot fires.
// Prevents handleMatchUpdate from restarting the timer on the first snapshot.
export function setLastSeen(turn, deadline) {
  _lastSeenTurn     = turn;
  _lastSeenDeadline = deadline;
}

function handleMatchUpdate(data, matchId) {
  const mp   = getState('multiplayer');
  const uid  = mp.playerId || auth.currentUser?.uid;
  if (!uid) return;
  const isP1 = data.player1?.uid === uid;

  // Transition waiting → active (host side — onSnapshot fires when player2 joins)
  if (data.status === 'active' && !_coinFlipShown) {
    _coinFlipShown = true;
    renderMultiplayerBoard(data, uid, isP1);
    showScreen('multiplayer');
    _lastSeenTurn     = data.current_turn;
    _lastSeenDeadline = data.turn_deadline;
    const oppName  = isP1 ? data.player2?.username : data.player1?.username;
    const myName   = isP1 ? data.player1?.username : data.player2?.username;
    const iGoFirst = data.current_turn === uid;
    showCoinFlip(myName || 'You', oppName || 'Opponent', iGoFirst).then(() => {
      startTurnCountdown(data.current_turn, data.turn_deadline, matchId);
    });
    return;
  }

  if (data.status === 'active') {
    updateMultiplayerUI(data, uid, isP1);
    // Only restart countdown when the active player or deadline actually changes
    if (data.current_turn !== _lastSeenTurn || data.turn_deadline !== _lastSeenDeadline) {
      _lastSeenTurn     = data.current_turn;
      _lastSeenDeadline = data.turn_deadline;
      startTurnCountdown(data.current_turn, data.turn_deadline, matchId);
    }
  }

  if (data.status === 'finished' || data.status === 'aborted') {
    stopTurnCountdown();
    if (_matchEndedId === matchId) return; // already processed — prevent double win/loss
    _matchEndedId = matchId;
    handleMatchEnd(data, uid);
  }
}

// ── Render MP Board ────────────────────────────────────────
export function renderMultiplayerBoard(data, uid, isP1) {
  const grid = document.getElementById('mp-card-grid');
  if (!grid) return;

  const p1 = data.player1;
  const p2 = data.player2;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('mp-username1', isP1 ? p1.username : p2?.username || '?');
  set('mp-username2', isP1 ? p2?.username || '?' : p1.username);
  set('mp-avatar1',   (isP1 ? p1.username : p2?.username || '?').charAt(0).toUpperCase());
  set('mp-avatar2',   (isP1 ? p2?.username || '?' : p1.username).charAt(0).toUpperCase());

  updateHPBar(1, isP1 ? p1.hp : p2?.hp ?? 100);
  updateHPBar(2, isP1 ? p2?.hp ?? 100 : p1.hp);

  grid.className = 'card-grid card-grid--mp';
  grid.innerHTML = '';

  data.board_state.forEach((card, idx) => {
    const el = document.createElement('div');
    el.className = `memory-card${card.matched ? ' matched flipped' : ''}`;
    el.dataset.index = idx;
    el.style.setProperty('--card-index', idx);
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', card.matched ? '-1' : '0');

    el.innerHTML = `
      <div class="card-inner">
        <div class="card-back" aria-hidden="true">
          <div class="card-back-dots">${Array(9).fill('<span></span>').join('')}</div>
        </div>
        <div class="card-front" aria-hidden="true">
          <i data-lucide="${card.icon}"></i>
        </div>
      </div>`;

    if (!card.matched) {
      el.addEventListener('click',   () => onMPCardClick(idx));
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onMPCardClick(idx); }
      });
    }
    grid.appendChild(el);
  });

  if (window.lucide) window.lucide.createIcons();
  updateTurnIndicator(data.current_turn === uid);

  // Render ability log on initial board render (e.g. on reconnect)
  if (data.ability_log) renderAbilityLog(data.ability_log);
}

// ── Update MP UI ───────────────────────────────────────────
// `showing` field in Firestore: array of card indices currently being shown
// to BOTH players (set when 2nd card is flipped, cleared on resolution).
// This is the single source of truth for "keep cards visible" — no local timers.
const _observerFlipTimers = {}; // kept for cleanup only

function updateMultiplayerUI(data, uid, isP1) {
  const p1 = data.player1;
  const p2 = data.player2;
  updateHPBar(1, isP1 ? p1.hp : p2?.hp ?? 100);
  updateHPBar(2, isP1 ? p2?.hp ?? 100 : p1.hp);
  updateTurnIndicator(data.current_turn === uid);

  // Render ability log from Firestore — both players see the same entries
  if (data.ability_log) renderAbilityLog(data.ability_log);

  // `showing` = indices that should be visually flipped for both players
  // Merge Firestore showing field with local clicks (active player guard)
  const showing = new Set([...(data.showing || []), ..._localShowing]);
  const domCards = document.querySelectorAll('#mp-card-grid .memory-card');

  data.board_state.forEach((card, idx) => {
    const el = domCards[idx];
    if (!el) return;

    if (card.matched) {
      el.classList.add('matched', 'flipped');
      return;
    }

    // Show if: Firestore says flipped OR it's in the `showing` set
    // Never hide a card the local player just clicked (_localShowing guard)
    const shouldShow = card.flipped || showing.has(idx);
    if (shouldShow) {
      el.classList.add('flipped');
    } else if (!_localShowing.has(idx)) {
      // Only remove flipped if we didn't click this card locally this turn
      el.classList.remove('flipped');
    }
  });
}

// ── MP Card Click ──────────────────────────────────────────
let _mpLocked      = false;
let _localShowing  = new Set(); // indices clicked locally this turn (active player only)

async function onMPCardClick(idx) {
  const mp  = getState('multiplayer');
  const uid = mp.playerId || auth.currentUser?.uid;
  if (!uid) return;
  if (!mp.matchId) return;
  if (_mpLocked) return;

  const matchRef = doc(db, 'games', 'multiplayer', mp.matchId, 'data');
  const snap     = await getDoc(matchRef);
  if (!snap.exists()) return;
  const data = snap.data();

  if (data.current_turn !== uid) {
    showToast("It's not your turn!", 'info', 1500);
    return;
  }

  const board   = data.board_state;
  const card    = board[idx];
  if (!card || card.matched || card.flipped) return;

  const flipped = data.flipped || [];
  if (flipped.length >= 2) return;

  board[idx].flipped = true;
  const newFlipped = [...flipped, idx];
  _localShowing.add(idx); // keep this card visible locally until turn resolves
  // Immediately flip card in DOM — don't wait for Firestore onSnapshot round-trip
  const _clickedEl = document.querySelector(`#mp-card-grid [data-index="${idx}"]`);
  if (_clickedEl) _clickedEl.classList.add('flipped');
  _mpLocked = true;

  if (newFlipped.length === 1) {
    // First card — just write the flip, no delay needed
    await updateDoc(matchRef, {
      board_state:           board,
      flipped:               newFlipped,
      showing:               newFlipped,
      last_action_timestamp: serverTimestamp(),
    });
    _localShowing.clear();
    _mpLocked = false;
  } else {
    // Second card — write both cards as "showing", then wait 1200ms, then resolve.
    // `showing: [i1, i2]` is read by updateMultiplayerUI on BOTH sides to keep
    // cards visible. Active player waits locally; observer waits via onSnapshot.
    await updateDoc(matchRef, {
      board_state:           board,
      flipped:               newFlipped,
      showing:               newFlipped,
      last_action_timestamp: serverTimestamp(),
    });

    // 1200ms so both players see both cards before resolution
    await new Promise(resolve => setTimeout(resolve, 1200));

    // Re-fetch fresh data after the wait — avoids stale HP/state from 1.2s ago
    const freshSnap2 = await getDoc(matchRef);
    if (!freshSnap2.exists()) return;
    const freshData2 = freshSnap2.data();
    // Abort if another process already resolved this turn (status changed or flipped cleared)
    if (freshData2.status !== 'active') return;
    if (!freshData2.flipped || freshData2.flipped.length < 2) return;

    await resolveMPMatch(matchRef, freshData2, freshData2.board_state, newFlipped, uid);
  }
}

// ── Resolve MP Match ───────────────────────────────────────
async function resolveMPMatch(matchRef, data, board, flipped, uid) {
  const [i1, i2] = flipped;
  const c1 = board[i1];
  const c2 = board[i2];

  // Guard: uid must match one of the two players, otherwise abort
  const isP1 = data.player1.uid === uid;
  const isP2 = data.player2.uid === uid;
  if (!isP1 && !isP2) {
    console.warn('[resolveMPMatch] uid does not match either player, aborting', uid);
    _localShowing.clear();
    _mpLocked = false;
    return;
  }

  if (c1.icon === c2.icon) {
    // Match!
    board[i1].matched = true;
    board[i2].matched = true;
    board[i1].flipped = false;
    board[i2].flipped = false;

    const newPairs  = (data.pairs_found || 0) + 1;
    const pairIndex = newPairs - 1;
    // Use pre-assigned ability from Firestore (randomised at room creation)
    // Fall back to cycling ABILITIES[] if field missing (old matches)
    const ability   = (data.pair_abilities && data.pair_abilities[pairIndex])
                      || getAbilityForPair(pairIndex);

    // last pair - only damage and heal
    const isLastPair = newPairs >= data.total_pairs;
    const allowedOnLast = ['damage', 'heal'];
    const effectiveAbility = isLastPair && !allowedOnLast.includes(ability)
      ? null
      : ability;

    let p1 = { ...data.player1 };
    let p2 = { ...data.player2 };
    // Default: after a match turn passes to opponent.
    // Only extra_turn ability overrides this.
    let nextTurn = isP1 ? data.player2.uid : data.player1.uid;

    // Who triggered this ability
    const whoName = isP1 ? p1.username : p2.username;
    let newLogEntry = null;

// Apply ability
    if (effectiveAbility === 'damage') {
      if (isP1) p2.hp = Math.max(0, p2.hp - 25);
      else      p1.hp = Math.max(0, p1.hp - 25);
      showAbilityToast('damage', '⚡ Deal 25 damage!');
      newLogEntry = { type: 'damage', who: whoName, text: 'dealt 25 dmg' };
    } else if (effectiveAbility === 'heal') {
      if (isP1) p1.hp = Math.min(100, p1.hp + 20);
      else      p2.hp = Math.min(100, p2.hp + 20);
      showAbilityToast('heal', '💚 Healed 20 HP!');
      newLogEntry = { type: 'heal', who: whoName, text: 'healed 20 HP' };
    } else if (effectiveAbility === 'extra_turn') {
      nextTurn = uid; // Only here does the active player keep the turn
      showAbilityToast('extra', '🔁 Extra turn!');
      newLogEntry = { type: 'extra', who: whoName, text: 'extra turn' };
    } else if (effectiveAbility === 'reveal_card') {
      showAbilityToast('reveal', '👁 Card revealed!');
      newLogEntry = { type: 'reveal', who: whoName, text: 'revealed card' };
      // Pass currently flipped indices so we don't reveal the same cards
    }

    // Build updated ability_log (prepend newest, keep last 5) — written to Firestore
    // so BOTH players see the same log via onSnapshot
    const prevLog = data.ability_log || [];
    const updatedLog = newLogEntry
      ? [newLogEntry, ...prevLog].slice(0, 5)
      : prevLog;

    // Track moves for the active player
    if (isP1) p1.player_moves = (data.player1_moves || 0) + 1;
    else      p2.player_moves = (data.player2_moves || 0) + 1;

// Always use explicit uid references — never rely on isP1 for winner assignment
const myUid  = uid;
const oppUid = isP1 ? data.player2.uid : data.player1.uid;
const self     = isP1 ? p1 : p2;
const opponent = isP1 ? p2 : p1;

let status = 'active';
let winner = null;

if (opponent.hp <= 0 && self.hp <= 0) {
  // Both at 0 HP simultaneously — treat as draw
  status = 'finished';
  winner = 'draw';
} else if (opponent.hp <= 0) {
  // Opponent out of HP — I win
  status = 'finished';
  winner = myUid;
} else if (self.hp <= 0) {
  // I ran out of HP (shouldn't happen in match branch, but guard it)
  status = 'finished';
  winner = oppUid;
} else if (newPairs >= data.total_pairs) {
  // All pairs found — both players alive, decide by pairs count
  const myPairs  = (data.pairs_found_p1 || 0) + (isP1 ? 1 : 0);
  const oppPairs = (data.pairs_found_p2 || 0) + (isP1 ? 0 : 1);

  if (myPairs > oppPairs) {
    status = 'finished';
    winner = myUid;
  } else if (oppPairs > myPairs) {
    status = 'finished';
    winner = oppUid;
  } else {
    // Equal pairs — HP tie-breaker
    status = 'finished';
    if (self.hp > opponent.hp)      winner = myUid;
    else if (opponent.hp > self.hp) winner = oppUid;
    else                            winner = 'draw';
  }
}
const deadlineMs = status === 'active' ? Date.now() + 30000 : null;

    // If reveal_card ability: show a random card to BOTH players via Firestore showing
    let revealShowing = [];
    if (effectiveAbility  === 'reveal_card') {
      const revIdx = revealRandomCard(board, flipped);
      if (revIdx !== null) revealShowing = [revIdx];
    }

    await updateDoc(matchRef, {
      board_state:     board,
      flipped:         [],
      showing:         revealShowing,
      player1:         p1,
      player2:         p2,
      current_turn:    nextTurn,
      pairs_found:     newPairs,
      pairs_found_p1:  (data.pairs_found_p1 || 0) + (isP1 ? 1 : 0),
      pairs_found_p2:  (data.pairs_found_p2 || 0) + (isP1 ? 0 : 1),
      player1_moves:   isP1 ? p1.player_moves : (data.player1_moves || 0),
      player2_moves:   isP1 ? (data.player2_moves || 0) : p2.player_moves,
      ability_log:     updatedLog,
      status,
      winner,
      turn_deadline:   deadlineMs,
      last_action_timestamp: serverTimestamp(),
    });

    // Clear the reveal after 3s (active player writes the clear)
    if (revealShowing.length > 0 && status === 'active') {
      setTimeout(async () => {
        try {
          await updateDoc(matchRef, { showing: [] });
        } catch(_) {}
      }, 3000);
    }

  } else {
    // Wrong match — -10HP, show flash, flip back, switch turn
    const el1 = document.querySelector(`#mp-card-grid [data-index="${i1}"]`);
    const el2 = document.querySelector(`#mp-card-grid [data-index="${i2}"]`);
    if (el1) el1.classList.add('wrong');
    if (el2) el2.classList.add('wrong');

    // Wait 300ms for wrong flash, then flip back
    await new Promise(resolve => setTimeout(resolve, 300));
    if (el1) { el1.classList.remove('wrong'); el1.classList.remove('flipped'); }
    if (el2) { el2.classList.remove('wrong'); el2.classList.remove('flipped'); }

    board[i1].flipped = false;
    board[i2].flipped = false;

    let p1 = { ...data.player1 };
    let p2 = { ...data.player2 };
    if (isP1) p1.hp = Math.max(0, p1.hp - 10);
    else      p2.hp = Math.max(0, p2.hp - 10);

    // Track moves for wrong match too
    if (isP1) p1.player_moves = (data.player1_moves || 0) + 1;
    else      p2.player_moves = (data.player2_moves || 0) + 1;

    const myUid2  = uid;
    const oppUid2 = isP1 ? data.player2.uid : data.player1.uid;
    const nextTurn   = oppUid2;
    const selfHp     = isP1 ? p1.hp : p2.hp;
    const status     = selfHp <= 0 ? 'finished' : 'active';
    const winner     = selfHp <= 0 ? oppUid2 : null; // I lost HP, opponent wins
    const deadlineMs = status === 'active' ? Date.now() + 30_000 : null;

    await updateDoc(matchRef, {
      board_state:   board,
      flipped:       [],
      showing:       [],
      player1:       p1,
      player2:       p2,
      player1_moves: isP1 ? p1.player_moves : (data.player1_moves || 0),
      player2_moves: isP1 ? (data.player2_moves || 0) : p2.player_moves,
      current_turn:  nextTurn,
      status,
      winner,
      turn_deadline: deadlineMs,
      last_action_timestamp: serverTimestamp(),
    });
  }

  _localShowing.clear();
  _mpLocked = false;
}

// ── Reveal Random Card ─────────────────────────────────────
function revealRandomCard(board, excludeIndices = []) {
  // Exclude already-matched and currently-flipped cards (just played this turn)
  const excluded = new Set(excludeIndices);
  const candidates = board
    .map((c, i) => ({ ...c, i }))
    .filter(c => !c.matched && !excluded.has(c.i));
  if (candidates.length === 0) return null;
  const target = candidates[Math.floor(Math.random() * candidates.length)];
  return target.i;
}

// ── Per-turn 30s Countdown ─────────────────────────────────
// Shows a live countdown in the turn indicator.
// When it hits 0, the current player's turn is forfeited.
let _countdownInterval = null;

function stopTurnCountdown() {
  if (_countdownInterval) {
    clearInterval(_countdownInterval);
    _countdownInterval = null;
  }
  // Reset timer display
  const timerEl = document.getElementById('turn-timer');
  if (timerEl) timerEl.textContent = '';
}

export function startTurnCountdown(currentTurnUid, deadlineMs, matchId) {
  stopTurnCountdown();
  // If deadline is missing or already passed by >2s, ignore (don't start countdown for stale deadlines)
  if (!deadlineMs || (deadlineMs - Date.now()) < -2_000) return;

  const uid = getState('multiplayer').playerId;

  _countdownInterval = setInterval(async () => {
    const remaining = Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000));

    const timerEl = document.getElementById('turn-timer');
    if (timerEl) {
      timerEl.textContent = `${remaining}s`;
      // Red when ≤10s
      timerEl.classList.toggle('turn-timer--urgent', remaining <= 10);
    }

    if (remaining <= 0) {
      stopTurnCountdown();

      // Only the player whose turn it is writes the forfeit
      // (prevents both players trying to write simultaneously)
      if (currentTurnUid !== uid) return;

      const mp       = getState('multiplayer');
      if (!mp.matchId) return;
      const matchRef = doc(db, 'games', 'multiplayer', mp.matchId, 'data');

      try {
        const snap = await getDoc(matchRef);
        if (!snap.exists()) return;
        const data = snap.data();
        // Double-check it's still our turn and still active
        if (data.status !== 'active' || data.current_turn !== uid) return;

        const isP1   = data.player1.uid === uid;
        const winner = isP1 ? data.player2.uid : data.player1.uid;
        await updateDoc(matchRef, {
          status: 'finished',
          winner,
          last_action_timestamp: serverTimestamp(),
          turn_deadline: null,
        });
      } catch(e) { console.warn('Turn timeout forfeit failed:', e.message); }
    }
  }, 250); // update 4× per second for smooth countdown
}

// ── Handle Match End ───────────────────────────────────────
function handleMatchEnd(data, uid) {
  stopTurnCountdown();
  _lastSeenTurn     = null;
  _lastSeenDeadline = null;
  // Clear ability log for next match (also reset logKey cache so next match re-renders)
  const _logList = document.getElementById('ability-log-list');
  if (_logList) { _logList.innerHTML = ''; delete _logList.dataset.logKey; }

  // Reset flags so next match starts clean
  _coinFlipShown = false;
  _matchEndedId  = null;

  // Clear any pending observer flip timers
  Object.keys(_observerFlipTimers).forEach(k => { clearTimeout(_observerFlipTimers[k]); delete _observerFlipTimers[k]; });

  const mp = getState('multiplayer');
  if (mp.unsubscribe) {
    mp.unsubscribe();
    setState('multiplayer', { unsubscribe: null });
  }
  if (mp.hostPollInterval) {
    clearInterval(mp.hostPollInterval);
    setState('multiplayer', { hostPollInterval: null });
  }

  // Reset lobby UI so Create Room + Join work fresh next time
  const createBtn = document.getElementById('btn-create-room');
  if (createBtn) { createBtn.disabled = false; createBtn.textContent = 'Create Room'; }
  const codeDisplay = document.getElementById('room-code-display');
  if (codeDisplay) codeDisplay.hidden = true;
  const joinInput = document.getElementById('join-code-input');
  if (joinInput) joinInput.value = '';
  const joinErr = document.getElementById('join-error');
  if (joinErr) { joinErr.hidden = true; joinErr.textContent = ''; }
  const joinBtn = document.getElementById('btn-join-room');
  if (joinBtn) { joinBtn.disabled = false; joinBtn.textContent = 'Join Room'; }

  resetMultiplayerState();

  const isDraw = data.winner === 'draw';
  const win    = !isDraw && data.winner === uid;
  const isP1   = data.player1?.uid === uid;
  updateMultiplayerRating(win, isDraw);

  // Elapsed time in seconds
  const elapsedMs = data.match_start_time
    ? Date.now() - data.match_start_time
    : 0;
  const elapsedSec = Math.round(elapsedMs / 1000);

  // Per-player stats
  const myMoves  = isP1 ? (data.player1_moves || 0) : (data.player2_moves || 0);
  const myPairs  = isP1 ? (data.pairs_found_p1 || 0) : (data.pairs_found_p2 || 0);
  const oppPairs = isP1 ? (data.pairs_found_p2 || 0) : (data.pairs_found_p1 || 0);
  const myHp     = isP1 ? (data.player1?.hp ?? 0) : (data.player2?.hp ?? 0);
  const oppHp    = isP1 ? (data.player2?.hp ?? 0) : (data.player1?.hp ?? 0);
  const hpDiff   = myHp - oppHp;

  showResults({
    win,
    isDraw,
    mode:       'multiplayer',
    time:       elapsedSec,
    moves:      myMoves,
    pairs:      myPairs,
    oppPairs,
    totalPairs: data.total_pairs || 8,
    hpDiff,
    isGuest:    false,
    isNewBest:  false,
  });
}

// ── Leave Match ────────────────────────────────────────────
export async function leaveMatch() {
  const mp = getState('multiplayer');
  if (!mp.matchId) return;

  stopTurnCountdown();

  const uid     = mp.playerId;
  const matchRef = doc(db, 'games', 'multiplayer', mp.matchId, 'data');

  try {
    const snap = await getDoc(matchRef);
    if (snap.exists() && snap.data().status === 'active') {
      const data   = snap.data();
      const winner = data.player1.uid === uid ? data.player2.uid : data.player1.uid;
      await updateDoc(matchRef, {
        status: 'aborted',
        winner,
        last_action_timestamp: serverTimestamp(),
      });
    }
  } catch(e) { /* best effort */ }

  resetMultiplayerState();
}
