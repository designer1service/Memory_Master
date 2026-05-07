# Memory Master

A production-ready browser-based memory card game built with vanilla HTML/CSS/JS and Firebase.
Developed as a university final thesis project at FERIT Osijek, University of Osijek, Croatia.

---

## Features

- **6 Game Modes** — Easy (4×3), Medium (4×4), Hard (5×4), Hardcore (6×5), Endless, and 1v1 Multiplayer
- **Real-time Multiplayer** — Room codes, HP system, match abilities (damage, heal, extra turn, reveal)
- **Firebase Auth** — Email/password login, registration, and guest play
- **Leaderboard** — Live top-10 leaderboard via Firestore
- **Best Time Tracking** — Per-mode personal records
- **Linear-inspired UI** — Dark surfaces, Inter font, accent #5e6ad2, CSS 3D card flips
- **Light/Dark Theme Toggle**
- **Fully Responsive** — 375px → 1440px, touch-friendly (min 44px targets)
- **No frameworks, no build tools** — pure ES modules

---

## Project Structure

```
memory_master/
├── index.html              # All screens (Auth, Dashboard, Game, Lobby, MP, Results)
├── css/
│   ├── main.css            # Tokens, reset, buttons, forms, toasts, nav
│   ├── dashboard.css       # Auth card, dashboard grid, stats, leaderboard, lobby
│   ├── game.css            # Card flip, grid, HUD, pause, MP, results, particles
│   └── themes.css          # Light theme overrides, reduced-motion
├── js/
│   ├── firebase.js         # Firebase initialization and exports
│   ├── app.js              # Entry point, event wiring
│   ├── auth.js             # Login, register, guest, logout, auth observer
│   ├── state_manager.js    # Central in-memory state (no localStorage)
│   ├── ui_manager.js       # Screen routing, toasts, HUD, particles, renders
│   ├── dashboard.js        # Stats, leaderboard, game result persistence
│   ├── game_logic.js       # Board generation, Fisher-Yates, flip logic, timer
│   └── multiplayer.js      # Room creation/joining, onSnapshot sync, abilities
├── firebase.json           # Firebase Hosting config
├── .firebaserc             # Project alias
├── firestore.rules         # Firestore security rules
└── .github/
    └── workflows/
        └── firebase-deploy.yml  # CI/CD — auto-deploy on push to main
```

---

## Firebase Setup

### 1. Project
The app is preconfigured for Firebase project `memory-master-a7213`.

### 2. Enable Services
In the [Firebase Console](https://console.firebase.google.com/project/memory-master-a7213):
- **Authentication** → Sign-in method → Enable **Email/Password**
- **Firestore Database** → Create in **production mode**
- **Hosting** → Get started (follow CLI prompts)

### 3. Deploy Firestore Rules
```bash
firebase deploy --only firestore:rules
```

### 4. Deploy to Hosting (manual)
```bash
firebase deploy --only hosting
```

### 5. CI/CD (GitHub Actions)
Push to `main` triggers auto-deploy via `.github/workflows/firebase-deploy.yml`.

**Required GitHub Secret:**
| Secret | Value |
|--------|-------|
| `FIREBASE_SERVICE_ACCOUNT` | JSON key from Firebase → Project Settings → Service Accounts → Generate new private key |

---

## Firestore Data Structure

```
users/{uid}
  username        string
  email           string
  created_at      timestamp
  preferences     { theme: string }

stats/{uid}
  total_matches   number
  wins            number
  losses          number
  best_times      { easy, medium, hard, hardcore }  (seconds | null)
  multiplayer_rating  number (default 1000)

games/singleplayer/{sessionId}/data
  uid             string
  mode            string
  status          'in_progress' | 'completed' | 'failed'
  board_state     string[]
  moves_taken     number
  timer_elapsed   number

games/multiplayer/{matchId}/data
  status          'waiting' | 'active' | 'finished' | 'aborted'
  room_code       string
  player1         { uid, username, hp }
  player2         { uid, username, hp } | null
  current_turn    string (uid)
  board_state     { icon, matched, flipped }[]
  flipped         number[]
  pairs_found     number
  total_pairs     number
  winner          string (uid) | null
  last_action_timestamp  timestamp

multiplayer_index/{matchId}
  match_id        string
  room_code       string
  status          string
```

---

## Game Mechanics

### Singleplayer
- **Fisher-Yates shuffle** for card randomisation
- **Two-card flip limit** — third click blocked until pair resolves
- **Wrong match**: cards flip back after 1000ms; Endless mode -2s penalty
- **Best time** tracked per difficulty on win
- **Endless**: board clears → new shuffled board + 10s bonus; wrong match = -2s; game ends when timer hits 0

### Multiplayer
- **HP System**: both players start at 100 HP
- **Wrong match**: -10 HP, turn switches
- **Match ability** (cycles per pair found):
  - `damage` — deal 50 HP to opponent
  - `heal` — restore 30 HP
  - `extra_turn` — keep your turn
  - `reveal_card` — briefly reveal a random unmatched card
- **Win condition**: opponent HP reaches 0, or you match all pairs first
- **Inactivity**: 60s timeout on current turn → opponent wins
- **Real-time sync** via Firestore `onSnapshot`

---

## Design Tokens

```css
--color-bg:           #0f0f0f
--color-surface:      #141414
--color-surface-2:    #1a1a1a
--color-surface-3:    #222222
--color-border:       rgba(255,255,255,0.08)
--color-text:         #e2e2e2
--color-text-muted:   #666666
--color-accent:       #5e6ad2
--color-accent-hover: #6b7ae8
--color-success:      #4caf7d
--color-danger:       #e5534b
--font-body:          'Inter', sans-serif
--radius-sm: 6px  --radius-md: 10px  --radius-lg: 16px
```

---

## Local Development

No build step required. Serve directly from the `memory_master/` directory:

```bash
# Python
python -m http.server 5500 --directory memory_master

# Node
npx serve memory_master

# VS Code
# Use "Live Server" extension, open memory_master/index.html
```

> Firebase ES module imports require a real HTTP server (not `file://`).

---

## Author

Developed by a student at **FERIT** (Faculty of Electrical Engineering, Computing and Information Technology),  
**University of Osijek**, Croatia — as a final thesis project.

---

## License

MIT — free to use, modify, and distribute.
