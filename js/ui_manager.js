// ═══════════════════════════════════════════════════════════
// Memory Master — ui_manager.js
// Screen routing, toasts, animations, theme, particles
// ═══════════════════════════════════════════════════════════

import { getState, setState } from './state_manager.js?v=1778247763';

// ── Screen Management ──────────────────────────────────────

const SCREENS = ['auth', 'dashboard', 'game', 'lobby', 'multiplayer', 'results'];

/**
 * Navigate to a screen by name.
 * @param {'auth'|'dashboard'|'game'|'lobby'|'multiplayer'|'results'} name
 */
export function showScreen(name) {
  SCREENS.forEach(id => {
    const el = document.getElementById(`screen-${id}`);
    if (el) el.classList.remove('active');
  });
  const target = document.getElementById(`screen-${name}`);
  if (target) {
    target.classList.add('active');
    setState('ui', { currentScreen: name });
    // Re-run Lucide icon rendering after DOM change
    if (window.lucide) window.lucide.createIcons();
  }
}

// ── Toast Notifications ────────────────────────────────────

/**
 * Show a toast message.
 * @param {string} message
 * @param {'info'|'success'|'error'} type
 * @param {number} duration ms
 */
export function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('removing');
    toast.addEventListener('animationend', () => toast.remove());
  }, duration);
}

// ── Theme ──────────────────────────────────────────────────

export function setTheme(theme) {
  document.body.setAttribute('data-theme', theme);
  setState('ui', { theme });
  const icon = document.querySelector('#theme-toggle i');
  if (icon) {
    icon.setAttribute('data-lucide', theme === 'light' ? 'moon' : 'sun');
    if (window.lucide) window.lucide.createIcons();
  }
}

export function toggleTheme() {
  const current = getState('ui.theme');
  setTheme(current === 'light' ? 'default' : 'light');
}

// ── User Info in Nav ───────────────────────────────────────

export function updateNavUser(username, isGuest = false) {
  const nameEl   = document.getElementById('nav-username');
  const avatarEl = document.getElementById('nav-avatar');
  if (nameEl)   nameEl.textContent   = username || 'Guest';
  if (avatarEl) avatarEl.textContent = (username || 'G').charAt(0).toUpperCase();
  if (isGuest && avatarEl) {
    avatarEl.style.background = '#555';
  } else if (avatarEl) {
    avatarEl.style.background = '';
  }
}

// ── Loading Button State ───────────────────────────────────

export function setButtonLoading(btnId, loading) {
  const btn     = document.getElementById(btnId);
  if (!btn) return;
  const textEl  = btn.querySelector('.btn-text');
  const spinEl  = btn.querySelector('.btn-spinner');
  btn.disabled  = loading;
  if (textEl) textEl.style.display  = loading ? 'none' : '';
  if (spinEl) spinEl.hidden          = !loading;
}

// ── Form Error ─────────────────────────────────────────────

export function showFormError(elId, message) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
}

export function clearFormError(elId) {
  const el = document.getElementById(elId);
  if (el) { el.textContent = ''; el.hidden = true; }
}

// ── HUD Update ─────────────────────────────────────────────

export function updateHUD({ mode, timer, moves, pairs, totalPairs }) {
  const fmt = (s) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  };

  const modeEl  = document.getElementById('hud-mode');
  const timerEl = document.getElementById('hud-timer');
  const movesEl = document.getElementById('hud-moves');
  const pairsEl = document.getElementById('hud-pairs');

  if (modeEl  && mode  !== undefined) modeEl.textContent  = mode.charAt(0).toUpperCase() + mode.slice(1);
  if (timerEl && timer !== undefined) timerEl.textContent = fmt(timer);
  if (movesEl && moves !== undefined) movesEl.textContent = moves;
  if (pairsEl && pairs !== undefined) pairsEl.textContent = `${pairs}/${totalPairs}`;
}

// ── MP HP Bars ─────────────────────────────────────────────

export function updateHPBar(player, hp) {
  const fillEl  = document.getElementById(`hp-fill${player}`);
  const valueEl = document.getElementById(`hp-value${player}`);
  if (!fillEl || !valueEl) return;
  const pct = Math.max(0, Math.min(100, hp));
  fillEl.style.width = `${pct}%`;
  valueEl.textContent = `${Math.round(hp)} HP`;
  // Color indicator
  if (pct > 60)       fillEl.setAttribute('data-hp', 'high');
  else if (pct > 30)  fillEl.setAttribute('data-hp', 'mid');
  else                fillEl.setAttribute('data-hp', 'low');
}

export function updateTurnIndicator(isMyTurn) {
  const pill = document.getElementById('turn-pill');
  const text = document.getElementById('turn-text');
  if (!pill || !text) return;
  if (isMyTurn) {
    pill.classList.add('active-turn');
    text.textContent = 'Your turn';
  } else {
    pill.classList.remove('active-turn');
    text.textContent = "Opponent's turn";
  }
}

// ── Ability Toast ──────────────────────────────────────────

export function showAbilityToast(type, text) {
  const container = document.getElementById('ability-toasts');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `ability-toast ability-toast--${type}`;
  toast.textContent = text;
  container.appendChild(toast);
  // Auto-remove after animation
  setTimeout(() => toast.remove(), 2100);
}

// ── Coin Flip ───────────────────────────────────────────────
// Shows a coin-flip animation then calls back with result.
// winner: true = local player goes first, false = opponent goes first.

export function showCoinFlip(localPlayerName, opponentName, localGoesFirst) {
  return new Promise(resolve => {
    const overlay  = document.getElementById('coin-flip-overlay');
    const labelEl  = document.getElementById('coin-flip-label');
    const coinEl   = document.getElementById('coin-el');
    const resultEl = document.getElementById('coin-flip-result');
    if (!overlay) { resolve(); return; }

    labelEl.textContent  = 'Flipping for first turn...';
    resultEl.textContent = '';
    resultEl.classList.remove('visible');
    coinEl.className     = 'coin';

    overlay.hidden = false;
    if (window.lucide) window.lucide.createIcons();

    // Start spin after brief delay
    setTimeout(() => {
      coinEl.classList.add('spinning');
    }, 200);

    // After spin ends, show result
    setTimeout(() => {
      coinEl.classList.remove('spinning');
      coinEl.classList.add(localGoesFirst ? 'result-heads' : 'result-tails');
      resultEl.textContent = localGoesFirst
        ? `You go first!`
        : `${opponentName} goes first!`;
      setTimeout(() => resultEl.classList.add('visible'), 50);

      // Hide overlay after result shown
      setTimeout(() => {
        overlay.hidden = true;
        coinEl.className = 'coin';
        resolve();
      }, 1800);
    }, 2000);
  });
}

// ── Ability Log ─────────────────────────────────────────────
// Renders ability log from Firestore array so BOTH players see the same log.
// Called by updateMultiplayerUI on every onSnapshot.

const ABILITY_ICONS = {
  damage: '⚡',
  heal:   '💚',
  extra:  '🔁',
  reveal: '👁',
};

/**
 * Re-renders the entire ability log from a Firestore array of entries.
 * Each entry: { type, who, text }
 * Called on every onSnapshot so both players stay in sync.
 */
export function renderAbilityLog(entries) {
  const list = document.getElementById('ability-log-list');
  if (!list) return;
  if (!entries || entries.length === 0) { list.innerHTML = ''; return; }

  // Only re-render if content actually changed (avoid flicker)
  const key = entries.map(e => `${e.type}${e.who}${e.text}`).join('|');
  if (list.dataset.logKey === key) return;
  list.dataset.logKey = key;

  list.innerHTML = entries.map(e => `
    <div class="ability-log-entry ability-log-entry--${e.type}">
      <span class="ability-log-entry__icon">${ABILITY_ICONS[e.type] || '✨'}</span>
      <span class="ability-log-entry__text">
        <span class="ability-log-entry__who">${escapeHTML(e.who)}</span> ${escapeHTML(e.text)}
      </span>
    </div>`).join('');
}


// ── Results Screen ─────────────────────────────────────────

export function showResults({ win, isDraw, mode, time, moves, pairs, oppPairs, totalPairs, hpDiff, isGuest, isNewBest }) {
  const fmt = (s) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  };

  document.getElementById('results-title').textContent    = isDraw ? 'Draw!' : (win ? 'You Won!' : 'Game Over');
  document.getElementById('results-subtitle').textContent = isDraw
    ? 'Equal pairs and HP — it\'s a tie!'
    : win ? (mode === 'endless' ? `Round ${pairs} completed!` : 'Excellent memory!') : 'Better luck next time.';
  document.getElementById('results-time').textContent     = fmt(time);
  document.getElementById('results-moves').textContent    = moves;
  // In multiplayer show "mine vs opponent" format, in singleplayer just "pairs/total"
  const pairsEl      = document.getElementById('results-pairs');
  const pairsLabelEl = document.getElementById('results-pairs-label');
  if (pairsLabelEl) pairsLabelEl.textContent = 'Pairs';
  pairsEl.textContent = `${pairs}/${totalPairs}`;

  // Accuracy stat: for multiplayer show HP advantage, for singleplayer show accuracy %
  const accLabelEl = document.getElementById('results-accuracy-label');
  const accValueEl = document.getElementById('results-accuracy');
  if (mode === 'multiplayer' && hpDiff !== undefined) {
    if (accLabelEl) accLabelEl.textContent = 'HP Advantage';
    const sign = hpDiff > 0 ? '+' : '';
    if (accValueEl) accValueEl.textContent = `${sign}${hpDiff} HP`;
  } else {
    if (accLabelEl) accLabelEl.textContent = 'Accuracy';
    const accuracy = moves > 0 ? Math.round((pairs / moves) * 100) : 0;
    if (accValueEl) accValueEl.textContent = `${accuracy}%`;
  }

  // Icon
  const icon = document.getElementById('results-icon');
  if (icon) {
    icon.className = `results-icon results-icon--${isDraw ? 'draw' : (win ? 'win' : 'lose')}`;
    const i = icon.querySelector('i');
    if (i) i.setAttribute('data-lucide', isDraw ? 'minus-circle' : (win ? 'trophy' : 'x-circle'));
  }

  const newBestEl = document.getElementById('results-new-best');
  if (newBestEl) newBestEl.hidden = !isNewBest;

  const upsellEl = document.getElementById('guest-upsell');
  if (upsellEl) upsellEl.hidden = !isGuest;



  if (window.lucide) window.lucide.createIcons();
  showScreen('results');

  if (win) spawnParticles();
}

// ── Particle Burst ─────────────────────────────────────────

export function spawnParticles() {
  const container = document.getElementById('particles-container');
  if (!container) return;
  container.innerHTML = '';

  const colors  = ['#5e6ad2','#4caf7d','#f5c518','#e5534b','#9c59b6','#6b7ae8'];
  const cx      = container.offsetWidth  / 2;
  const cy      = container.offsetHeight / 2;
  const count   = 60;

  for (let i = 0; i < count; i++) {
    const p       = document.createElement('div');
    const color   = colors[i % colors.length];
    const size    = 4 + Math.random() * 8;
    const angle   = (Math.random() * 360) * (Math.PI / 180);
    const dist    = 80 + Math.random() * 180;
    const tx      = Math.cos(angle) * dist;
    const ty      = Math.sin(angle) * dist - 60;
    const dur     = 0.8 + Math.random() * 0.8;
    const delay   = Math.random() * 0.4;
    const rot     = (Math.random() * 720 - 360);

    p.className    = 'particle';
    p.style.cssText = `
      width:${size}px; height:${size}px; background:${color};
      left:${cx}px; top:${cy}px;
      --tx:${tx}px; --ty:${ty}px; --dur:${dur}s; --delay:${delay}s; --rot:${rot}deg;
    `;
    container.appendChild(p);
  }
}

// ── Leaderboard Render ─────────────────────────────────────

export function renderLeaderboard(entries, currentUid) {
  const list = document.getElementById('leaderboard-list');
  if (!list) return;

  if (!entries || entries.length === 0) {
    list.innerHTML = '<div class="leaderboard-empty">No entries yet. Be the first!</div>';
    return;
  }

  list.innerHTML = entries.map((entry, idx) => {
    const rank   = idx + 1;
    const rankCls =
      rank === 1 ? 'leaderboard-rank--gold'   :
      rank === 2 ? 'leaderboard-rank--silver' :
      rank === 3 ? 'leaderboard-rank--bronze' : '';
    const isSelf = entry.uid === currentUid;

    return `
      <div class="leaderboard-row ${isSelf ? 'leaderboard-row--self' : ''}">
        <div class="leaderboard-rank ${rankCls}">${rank}</div>
        <div class="leaderboard-user">
          <span class="leaderboard-name">${escapeHTML(entry.username || 'Player')}</span>
          <span class="leaderboard-rating">Rating ${escapeHTML(String(entry.multiplayer_rating ?? 1000))}</span>
        </div>
        <div class="leaderboard-score">${escapeHTML(String(entry.wins ?? 0))}W</div>
      </div>
    `;
  }).join('');
}

// ── Stats Display ──────────────────────────────────────────

export function renderStats(stats) {
  const fmt = (s) => {
    if (!s) return '--:--';
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  };

  const wins    = stats.wins    || 0;
  const losses  = stats.losses  || 0;
  const total   = stats.total_matches || 0;
  const winrate = total > 0 ? Math.round((wins / total) * 100) : 0;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('stat-wins',    wins);
  set('stat-losses',  losses);
  set('stat-matches', total);
  set('stat-winrate', `${winrate}%`);
  set('stats-rating', `Rating: ${stats.multiplayer_rating || 1000}`);
  set('bt-easy',      fmt(stats.best_times?.easy));
  set('bt-medium',    fmt(stats.best_times?.medium));
  set('bt-hard',      fmt(stats.best_times?.hard));
  set('bt-hardcore',  fmt(stats.best_times?.hardcore));
}

// ── Room Code Display ──────────────────────────────────────

export function showRoomCode(code) {
  const display = document.getElementById('room-code-display');
  const value   = document.getElementById('room-code-value');
  if (display && value) {
    value.textContent = code;
    display.hidden = false;
  }
}

// ── Utility ───────────────────────────────────────────────

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
