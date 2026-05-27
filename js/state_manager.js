// ═══════════════════════════════════════════════════════════
// Memory Master — state_manager.js
// Central in-memory state store. All state lives in JS memory only.
// ═══════════════════════════════════════════════════════════

/** @type {AppState} */
const state = {
  // Auth
  user: null,       // Firebase user | null (null = guest or logged out)
  isGuest: false,
  guestName: '',

  // Stats (loaded from Firestore)
  stats: {
    total_matches: 0,
    wins: 0,
    losses: 0,
    best_times: { easy: null, medium: null, hard: null, hardcore: null },
    multiplayer_rating: 1000,
  },

  // Singleplayer
  game: {
    mode: null,          // 'easy' | 'medium' | 'hard' | 'hardcore' | 'endless'
    sessionId: null,
    cards: [],           // Array<CardState>
    flipped: [],         // indices of currently flipped (max 2)
    matched: [],         // indices of matched cards
    moves: 0,
    pairsFound: 0,
    totalPairs: 0,
    timerSeconds: 0,
    timerInterval: null,
    paused: false,
    started: false,
    // Endless-specific
    endlessRound: 0,
    endlessTimeLimit: 120,
  },

  // Multiplayer
  multiplayer: {
    matchId: null,
    roomCode: null,
    isHost: false,
    playerId: null,
    opponentId: null,
    unsubscribe: null,        // Firestore onSnapshot unsubscribe fn
    inactivityTimeout: null,
    hostPollInterval: null,   // polling fallback for host
  },

  // UI
  ui: {
    currentScreen: 'auth',
    theme: 'default',
  },
};

/**
 * Get a deep copy of a state slice by dot-notation key.
 * e.g. getState('game.moves')
 */
export function getState(path) {
  if (!path) return state;
  return path.split('.').reduce((obj, key) => obj?.[key], state);
}

/**
 * Shallow-merge an update object into a state slice by dot-notation key.
 * e.g. setState('game', { moves: 5 })
 */
export function setState(path, update) {
  const keys = path.split('.');
  let target = state;
  for (let i = 0; i < keys.length - 1; i++) {
    target = target[keys[i]];
  }
  const last = keys[keys.length - 1];
  if (typeof target[last] === 'object' && target[last] !== null && !Array.isArray(target[last])) {
    Object.assign(target[last], update);
  } else {
    target[last] = update;
  }
}

/** Reset game state for a new session */
export function resetGameState() {
  const current = getState('game');
  if (current.timerInterval) clearInterval(current.timerInterval);
  setState('game', {
    mode: null,
    sessionId: null,
    cards: [],
    flipped: [],
    matched: [],
    moves: 0,
    pairsFound: 0,
    totalPairs: 0,
    timerSeconds: 0,
    timerInterval: null,
    paused: false,
    started: false,
    endlessRound: 0,
    endlessTimeLimit: 120,
  });
}

/** Reset multiplayer state */
export function resetMultiplayerState() {
  const mp = getState('multiplayer');
  if (mp.inactivityTimeout) clearTimeout(mp.inactivityTimeout);
  if (mp.hostPollInterval) clearInterval(mp.hostPollInterval);
  if (mp.unsubscribe) mp.unsubscribe();
  setState('multiplayer', {
    matchId: null,
    roomCode: null,
    isHost: false,
    playerId: null,
    opponentId: null,
    unsubscribe: null,
    inactivityTimeout: null,
    hostPollInterval: null,
  });
}
