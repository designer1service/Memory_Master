// ═══════════════════════════════════════════════════════════
// Memory Master — app.js
// Entry point: wires all modules, event listeners, routing
// ═══════════════════════════════════════════════════════════

import { initAuthObserver,
         handleLogin, handleRegister, handleGuest, handleLogout } from './auth.js?v=1778247069';
import { startGame, pauseGame, resumeGame, endGame }              from './game_logic.js?v=1778247069';
import { createRoom, joinRoom, leaveMatch }                        from './multiplayer.js?v=1778247069';
import { showScreen, showToast, toggleTheme }                     from './ui_manager.js?v=1778247069';
import { getState, resetGameState, resetMultiplayerState }        from './state_manager.js?v=1778247069';

// ─── Init ────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Render Lucide icons initially
  if (window.lucide) window.lucide.createIcons();

  // Start Firebase auth observer
  initAuthObserver();

  // ── AUTH Screen ─────────────────────────────────────────
  bindAuthTabs();

  getEl('btn-login')?.addEventListener('click', handleLogin);
  getEl('btn-register')?.addEventListener('click', handleRegister);
  getEl('btn-guest')?.addEventListener('click', handleGuest);

  // Enter key on login/register inputs
  ['login-email','login-password'].forEach(id => {
    getEl(id)?.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleLogin(); });
  });
  ['reg-username','reg-email','reg-password'].forEach(id => {
    getEl(id)?.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleRegister(); });
  });
  getEl('guest-name')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleGuest(); });

  // ── DASHBOARD ────────────────────────────────────────────

  // Singleplayer mode buttons
  document.querySelectorAll('.mode-btn[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      if (mode) startGame(mode);
    });
  });

  // Multiplayer lobby button
  getEl('btn-go-multiplayer')?.addEventListener('click', () => {
    const user    = getState('user');
    const isGuest = getState('isGuest');
    if (isGuest) {
      showToast('Create a free account to play multiplayer!', 'info');
      return;
    }
    if (!user) {
      showToast('Sign in to play multiplayer.', 'info');
      return;
    }
    showScreen('lobby');
  });

  // Logout
  getEl('btn-logout')?.addEventListener('click', handleLogout);

  // Theme toggle
  getEl('theme-toggle')?.addEventListener('click', toggleTheme);

  // ── SINGLEPLAYER GAME ────────────────────────────────────

  getEl('btn-game-back')?.addEventListener('click', () => {
    const g = getState('game');
    if (g.timerInterval) clearInterval(g.timerInterval);
    resetGameState();
    showScreen('dashboard');
  });

  getEl('btn-game-pause')?.addEventListener('click', () => {
    const g = getState('game');
    if (g.paused) resumeGame();
    else          pauseGame();
    // Toggle icon
    const icon = document.querySelector('#btn-game-pause i');
    if (icon) {
      icon.setAttribute('data-lucide', g.paused ? 'pause' : 'play');
      if (window.lucide) window.lucide.createIcons();
    }
  });

  getEl('btn-resume')?.addEventListener('click', () => {
    resumeGame();
    const icon = document.querySelector('#btn-game-pause i');
    if (icon) { icon.setAttribute('data-lucide', 'pause'); if (window.lucide) window.lucide.createIcons(); }
  });

  getEl('btn-restart')?.addEventListener('click', () => {
    const mode = getState('game.mode');
    if (mode) startGame(mode);
  });

  getEl('btn-pause-dashboard')?.addEventListener('click', () => {
    resumeGame();
    const g = getState('game');
    if (g.timerInterval) clearInterval(g.timerInterval);
    resetGameState();
    showScreen('dashboard');
  });

  // Keyboard: Escape to pause/resume
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const screen = getState('ui.currentScreen');
      if (screen === 'game') {
        const g = getState('game');
        if (g.paused) resumeGame();
        else          pauseGame();
      }
    }
  });

  // ── LOBBY ────────────────────────────────────────────────

  getEl('btn-lobby-back')?.addEventListener('click', () => {
    resetMultiplayerState();
    showScreen('dashboard');
  });

  getEl('btn-create-room')?.addEventListener('click', async () => {
    const btn = getEl('btn-create-room');
    btn.disabled = true;
    btn.textContent = 'Creating...';
    try {
      // 15s timeout so button never stays frozen on slow mobile connections
      await Promise.race([
        createRoom(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Request timed out. Check your connection.')), 15_000)),
      ]);
    } catch(e) {
      showToast(e?.message || e?.code || 'Could not create room. Try again.', 'error');
      console.error(e);
      btn.disabled = false;
      btn.textContent = 'Create Room';
    }
    // Note: on success, button stays disabled (user is now in the waiting room)
  });

  getEl('btn-join-room')?.addEventListener('click', async () => {
    const code = getEl('join-code-input')?.value?.trim().toUpperCase();
    const errEl = getEl('join-error');
    if (errEl) { errEl.hidden = true; errEl.textContent = ''; }

    if (!code || code.length !== 6) {
      if (errEl) { errEl.textContent = 'Enter a valid 6-character code.'; errEl.hidden = false; }
      return;
    }

    const btn = getEl('btn-join-room');
    btn.disabled = true;
    btn.textContent = 'Joining...';

    let result;
    try {
      result = await Promise.race([
        joinRoom(code),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Request timed out. Check your connection.')), 15_000)),
      ]);
    } catch(e) {
      showToast(e?.message || e?.code || 'Could not join room. Try again.', 'error');
      console.error('joinRoom error:', e);
      btn.disabled = false;
      btn.textContent = 'Join Room';
      return;
    }

    // On 'ok', joinRoom already called showScreen('multiplayer') — don't reset button
    if (result === 'ok') return;

    btn.disabled = false;
    btn.textContent = 'Join Room';

    if (result === 'not_found') {
      if (errEl) { errEl.textContent = 'Room not found or already started. Check the code.'; errEl.hidden = false; }
    } else if (result === 'same_player') {
      if (errEl) { errEl.textContent = "You can't join your own room."; errEl.hidden = false; }
    } else if (result === 'invalid') {
      if (errEl) { errEl.textContent = 'Invalid code format.'; errEl.hidden = false; }
    } else {
      showToast('Could not join room. Try again.', 'error');
    }
  });

  getEl('join-code-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') getEl('btn-join-room')?.click();
  });

  // ── RESULTS ─────────────────────────────────────────────

  getEl('btn-results-dashboard')?.addEventListener('click', () => {
    resetGameState();
    showScreen('dashboard');
  });

  // Guest upsell → go to auth register tab
  getEl('btn-upsell-register')?.addEventListener('click', () => {
    showScreen('auth');
    switchAuthTab('register');
  });
});

// ─── Auth Tab Binding ─────────────────────────────────────

function bindAuthTabs() {
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => switchAuthTab(tab.dataset.tab));
  });
}

function switchAuthTab(tabId) {
  document.querySelectorAll('.auth-tab').forEach(t => {
    const active = t.dataset.tab === tabId;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('.auth-panel').forEach(p => {
    p.classList.toggle('active', p.id === `panel-${tabId}`);
  });
}

// ─── Helper ───────────────────────────────────────────────
function getEl(id) { return document.getElementById(id); }
