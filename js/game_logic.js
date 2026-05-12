// ═══════════════════════════════════════════════════════════
// Memory Master — game_logic.js
// Board generation, Fisher-Yates shuffle, flip logic,
// timer, match detection, singleplayer Firestore sync
// ═══════════════════════════════════════════════════════════

import {
  doc, setDoc, updateDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import {
  collection, addDoc,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

import { db }                                            from './firebase.js?v=1778595091';
import { getState, setState, resetGameState }            from './state_manager.js?v=1778595091';
import { showScreen, updateHUD, showResults, showToast } from './ui_manager.js?v=1778595091';
import { saveGameResult }                                from './dashboard.js?v=1778595091';

// ── Icon pool ──────────────────────────────────────────────

const ICONS = [
  'zap','flame','star','heart','diamond','crown','shield',
  'moon','sun','cloud','leaf','anchor','ghost','gem','target',
  'compass','rocket','bell','key','eye',
];

// Mode config: { cols, rows, pairs }
const MODE_CONFIG = {
  easy:     { cols: 4, rows: 3,  pairs: 6  },
  medium:   { cols: 4, rows: 4,  pairs: 8  },
  hard:     { cols: 5, rows: 4,  pairs: 10 },
  hardcore: { cols: 6, rows: 5,  pairs: 15 },
  endless:  { cols: 4, rows: 3,  pairs: 6  },
};

// ── Fisher-Yates Shuffle ───────────────────────────────────

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Generate Board ─────────────────────────────────────────

export function generateBoard(mode) {
  const config = MODE_CONFIG[mode] || MODE_CONFIG.easy;
  const iconSubset = shuffle(ICONS).slice(0, config.pairs);
  const pairs = shuffle([...iconSubset, ...iconSubset]);
  return pairs.map((icon, idx) => ({
    id:      idx,
    icon,
    flipped: false,
    matched: false,
  }));
}

// ── Start Singleplayer Game ────────────────────────────────

export async function startGame(mode) {
  resetGameState();
  const config   = MODE_CONFIG[mode] || MODE_CONFIG.easy;
  const cards    = generateBoard(mode);
  const sessionId = `sp_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;

  setState('game', {
    mode,
    sessionId,
    cards,
    totalPairs: config.pairs,
    started: false,
    endlessTimeLimit: mode === 'endless' ? 120 : null,
    endlessRound: 0,
  });

  // Persist to Firestore (non-guest)
  const user = getState('user');
  if (user) {
    try {
      await setDoc(doc(db, 'games', 'singleplayer', sessionId, 'data'), {
        uid:         user.uid,
        mode,
        status:      'in_progress',
        board_state: cards.map(c => c.icon),
        moves_taken:    0,
        timer_elapsed:  0,
        created_at:     serverTimestamp(),
      });
    } catch(e) { console.warn('Could not persist game session:', e.message); }
  }

  renderBoard(mode, cards);
  showScreen('game');
  startTimer();
}

// ── Render Board ───────────────────────────────────────────

export function renderBoard(mode, cards) {
  const grid = document.getElementById('card-grid');
  if (!grid) return;

  // Set grid class
  grid.className = `card-grid card-grid--${mode}`;
  grid.innerHTML = '';

  cards.forEach((card, idx) => {
    const el = document.createElement('div');
    el.className = 'memory-card';
    el.dataset.index = idx;
    el.style.setProperty('--card-index', idx);
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', `Card ${idx + 1}`);
    el.setAttribute('tabindex', '0');

    el.innerHTML = `
      <div class="card-inner">
        <div class="card-back" aria-hidden="true">
          <div class="card-back-dots">
            ${Array(9).fill('<span></span>').join('')}
          </div>
        </div>
        <div class="card-front" aria-hidden="true">
          <i data-lucide="${card.icon}"></i>
        </div>
      </div>
    `;

    el.addEventListener('click',    () => onCardClick(idx));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCardClick(idx); } });
    grid.appendChild(el);
  });

  if (window.lucide) window.lucide.createIcons();

  // Update HUD
  const config = MODE_CONFIG[mode] || MODE_CONFIG.easy;
  updateHUD({ mode, timer: 0, moves: 0, pairs: 0, totalPairs: config.pairs });
}

// ── Timer ──────────────────────────────────────────────────

function startTimer() {
  const game = getState('game');
  if (game.timerInterval) clearInterval(game.timerInterval);

  // Endless mode: countdown
  if (game.mode === 'endless') {
    setState('game', { timerSeconds: game.endlessTimeLimit, started: true });
    const interval = setInterval(() => {
      const g = getState('game');
      if (g.paused) return;
      const newTime = g.timerSeconds - 1;
      setState('game', { timerSeconds: newTime });
      updateHUD({ timer: newTime, moves: g.moves, pairs: g.pairsFound, totalPairs: g.totalPairs });
      if (newTime <= 0) {
        clearInterval(interval);
        endGame(false);
      }
    }, 1000);
    setState('game', { timerInterval: interval });
  } else {
    setState('game', { timerSeconds: 0, started: true });
    const interval = setInterval(() => {
      const g = getState('game');
      if (g.paused) return;
      const newTime = g.timerSeconds + 1;
      setState('game', { timerSeconds: newTime });
      updateHUD({ timer: newTime, moves: g.moves, pairs: g.pairsFound, totalPairs: g.totalPairs });
    }, 1000);
    setState('game', { timerInterval: interval });
  }
}

export function pauseGame() {
  const g = getState('game');
  if (!g.started) return;
  setState('game', { paused: true });
  const overlay = document.getElementById('pause-overlay');
  if (overlay) overlay.hidden = false;
}

export function resumeGame() {
  setState('game', { paused: false });
  const overlay = document.getElementById('pause-overlay');
  if (overlay) overlay.hidden = true;
}

export function stopTimer() {
  const interval = getState('game.timerInterval');
  if (interval) clearInterval(interval);
  setState('game', { timerInterval: null });
}

// ── Card Flip Logic ────────────────────────────────────────

let _flipLocked = false;

export function onCardClick(idx) {
  const g = getState('game');
  if (g.paused || !g.started) return;
  if (_flipLocked) return;

  const card = g.cards[idx];
  if (!card || card.matched || card.flipped) return;
  if (g.flipped.length >= 2) return;

  // Flip card
  card.flipped = true;
  const flipped = [...g.flipped, idx];
  setState('game', { flipped });
  flipCardEl(idx, true);

  if (flipped.length === 2) {
    const newMoves = g.moves + 1;
    setState('game', { moves: newMoves });
    updateHUD({ moves: newMoves });
    checkMatch(flipped[0], flipped[1]);
  }
}

function flipCardEl(idx, faceUp) {
  const el = document.querySelector(`[data-index="${idx}"]`);
  if (!el) return;
  if (faceUp) el.classList.add('flipped');
  else        el.classList.remove('flipped');
}

function checkMatch(i1, i2) {
  const g = getState('game');
  const c1 = g.cards[i1];
  const c2 = g.cards[i2];

  if (c1.icon === c2.icon) {
    // Match!
    _flipLocked = false;
    c1.matched = true;
    c2.matched = true;
    setState('game', { flipped: [] });

    const el1 = document.querySelector(`[data-index="${i1}"]`);
    const el2 = document.querySelector(`[data-index="${i2}"]`);
    if (el1) el1.classList.add('matched');
    if (el2) el2.classList.add('matched');

    const newPairs = g.pairsFound + 1;
    setState('game', { pairsFound: newPairs });
    updateHUD({ pairs: newPairs, totalPairs: g.totalPairs });

    if (newPairs >= g.totalPairs) {
      // Board cleared
      if (g.mode === 'endless') {
        handleEndlessComplete();
      } else {
        setTimeout(() => endGame(true), 500);
      }
    }
  } else {
    // Wrong match
    _flipLocked = true;
    const el1 = document.querySelector(`[data-index="${i1}"]`);
    const el2 = document.querySelector(`[data-index="${i2}"]`);
    if (el1) el1.classList.add('wrong');
    if (el2) el2.classList.add('wrong');

    // Endless mode: -2s penalty
    if (g.mode === 'endless') {
      const newTime = Math.max(0, g.timerSeconds - 2);
      setState('game', { timerSeconds: newTime });
    }

    setTimeout(() => {
      const g2 = getState('game');
      g2.cards[i1].flipped = false;
      g2.cards[i2].flipped = false;
      setState('game', { flipped: [] });
      flipCardEl(i1, false);
      flipCardEl(i2, false);
      const e1 = document.querySelector(`[data-index="${i1}"]`);
      const e2 = document.querySelector(`[data-index="${i2}"]`);
      if (e1) e1.classList.remove('wrong');
      if (e2) e2.classList.remove('wrong');
      _flipLocked = false;
    }, 1000);
  }
}

// ── Endless Mode ───────────────────────────────────────────

function handleEndlessComplete() {
  const g = getState('game');
  const round = g.endlessRound + 1;
  // +10s bonus
  const bonusTime = g.timerSeconds + 10;

  stopTimer();

  // Generate new board
  const newCards = generateBoard('endless');
  setState('game', {
    cards:      newCards,
    flipped:    [],
    matched:    [],
    pairsFound: 0,
    timerSeconds: bonusTime,
    endlessRound: round,
  });

  showToast(`Round ${round} complete! +10s bonus`, 'success', 2000);
  renderBoard('endless', newCards);
  startTimer();
}

// ── End Game ───────────────────────────────────────────────

export async function endGame(win) {
  const g    = getState('game');
  stopTimer();

  const isGuest = getState('isGuest');
  let isNewBest = false;

  if (!isGuest && win && g.mode !== 'endless') {
    isNewBest = await saveGameResult({
      mode:    g.mode,
      time:    g.timerSeconds,
      moves:   g.moves,
      pairs:   g.pairsFound,
      win,
    });
  } else if (!isGuest) {
    await saveGameResult({
      mode:  g.mode,
      time:  g.timerSeconds,
      moves: g.moves,
      pairs: g.pairsFound,
      win,
    });
  }

  // Update Firestore session
  const user = getState('user');
  if (user && g.sessionId) {
    try {
      await updateDoc(doc(db, 'games', 'singleplayer', g.sessionId, 'data'), {
        status:         win ? 'completed' : 'failed',
        moves_taken:    g.moves,
        timer_elapsed:  g.timerSeconds,
      });
    } catch(e) { /* non-critical */ }
  }

  showResults({
    win,
    mode:       g.mode,
    time:       g.timerSeconds,
    moves:      g.moves,
    pairs:      g.pairsFound,
    totalPairs: g.totalPairs,
    isGuest,
    isNewBest,
  });
}
