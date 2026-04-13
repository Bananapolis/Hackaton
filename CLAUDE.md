# CLAUDE.md — Live Pulse Agent Onboarding

This file is the primary onboarding document for AI agents working on the **Live Pulse** codebase.
Read this before making any changes. Then read [README.md](README.md) for user-facing context.

---

## What this project is

**Live Pulse** is a browser-based live classroom engagement platform built for a hackathon. A teacher hosts a session and shares their screen; students join via a URL or
QR code and interact through real-time engagement signals, anonymous questions, and AI-generated
quizzes. The backend is a single FastAPI process backed by SQLite. The frontend is a React SPA.

Actors: **teacher** (session host) and **student** (participant). Both connect to the same
WebSocket endpoint; the server routes events by role.

---

## Repository layout

```
backend/            FastAPI app (Python 3.12, Uvicorn, SQLite)
  app/
    main.py         App factory — mounts routers
    config.py       Env-var settings (pydantic-settings)
    database.py     SQLite schema, migrations, query helpers
    state.py        In-memory RuntimeSession state machine
    models.py       Pydantic request/response models
    routers/
      auth.py       Register, login, GitHub/Google OAuth callbacks
      sessions.py   Session CRUD, rejoin-status endpoint
      websocket.py  WebSocket signaling hub (main event loop, 30 KB)
      presentations.py  Upload/download, AI notes generation
      quizzes.py    Quiz library CRUD, live answer gating
    services/
      ai.py         Gemini (primary) / OpenAI (fallback) quiz generation
      analytics.py  Engagement metric calculations
      documents.py  PPTX/PDF processing
      pdf_report.py Session PDF export
  tests/            pytest suite (85 % coverage gate)

frontend/           React 18 + Vite SPA (Node 20, Tailwind CSS)
  src/
    App.jsx         Monolithic component (~4 000 lines) — all teacher/student UI
    config.js       API base URL, WebRTC ICE server list
    components/     Reusable leaf components
  tests/            Vitest suite (75 % coverage gate)

desktop/            Electron wrapper (opens vialive.libreuni.com)
docs/               Architecture, security, OAuth, dev-env guides
deploy/             Caddyfile (TLS termination)
scripts/            Deploy + server-setup automation
.agent/CONTINUITY.md  Chronological change log — update after material changes
```

---

## How to run locally

### Backend only
```bash
cd backend
pip install -r requirements.txt
cp .env.example .env   # fill in at minimum GEMINI_API_KEY
uvicorn app.main:app --reload --port 8000
```

### Frontend only
```bash
cd frontend
npm install
npm run dev            # Vite dev server on :5173, proxies /api → localhost:8000
```

### Full stack (Docker Compose)
```bash
docker compose -f docker-compose.dev.yml up --build
# backend on :8000, frontend on :5173, no TURN relay in dev
```

### Makefile shortcuts
```bash
make backend-run       # uvicorn --reload
make backend-check     # syntax-only compile check
make frontend-dev      # vite dev
make frontend-build    # vite prod build
```

---

## How to test

Always run the relevant test suite after code changes. **CI will block deploys on failure.**

### Backend (must stay ≥ 85 % coverage)
```bash
cd backend
pytest                          # all tests
pytest --tb=short -q            # quieter output
pytest tests/test_websocket.py  # single file
```

### Frontend (must stay ≥ 75 % coverage)
```bash
cd frontend
npm test                        # watch mode
npm run test:coverage           # full coverage report
```

### Build checks (run before marking a task done)
```bash
cd backend && python -m compileall app/   # syntax check
cd frontend && npm run build              # Vite prod build
```

---

## Architecture — things you must understand

### WebSocket message protocol
All real-time events flow through a single WebSocket endpoint at `/ws/{session_code}`.
Messages are JSON objects with a top-level `"type"` field. Key types:

| Direction        | Type                        | Effect                                   |
|------------------|-----------------------------|------------------------------------------|
| client → server  | `join`                      | Register role; server sends `session_state` snapshot |
| client → server  | `confusion_signal`          | Increment confusion counter              |
| client → server  | `break_vote`                | Cast a break vote                        |
| client → server  | `ask_question`              | Submit anonymous question                |
| client → server  | `resolve_question`          | Teacher marks question resolved          |
| client → server  | `generate_quiz`             | Teacher triggers AI quiz generation      |
| client → server  | `launch_quiz` / `close_quiz`| Control quiz lifecycle                   |
| client → server  | `reveal_answer`             | Reveal correct answer + per-option stats |
| server → client  | `session_state`             | Full state snapshot (sent on join/change)|
| server → client  | `quiz_state`                | Quiz lifecycle change broadcast          |
| server → client  | `anonymous_questions`       | Updated question list for teacher        |

WebRTC signaling (`offer`, `answer`, `ice_candidate`) also flows through the same WebSocket.

### Runtime state vs. persistent state
- `backend/app/state.py` — `RuntimeSession` holds **in-memory** live data (connected clients,
  confusion counts, break votes, anonymous questions, WebRTC offers). Lost on server restart.
- `backend/app/database.py` — SQLite stores durable data (users, sessions metadata, quizzes,
  analytics snapshots). Persists across restarts.

### AI quiz generation
`backend/app/services/ai.py` tries Gemini first, falls back to OpenAI-compatible endpoint.
Generation runs in `asyncio.to_thread` so it does not block the WebSocket event loop.
Timeout is 45 s (configurable via `AI_QUIZ_GENERATION_TIMEOUT_SECONDS`).
Generated quizzes are auto-saved to SQLite for the session host.

### Answer gating (anti-cheat)
While a quiz is live, `correct_option_id` is stripped from API responses.
`answer_revealed` flag on `RuntimeSession` controls visibility. Only the teacher can reveal.

### Rejoin flow
On disconnect, `state.py` records a timestamp. The `/api/sessions/rejoin-status` endpoint
(auth required) returns a rejoin candidate if the grace window (default 2 min) has not expired.
The frontend polls this endpoint and surfaces a "Rejoin" button.

---

## Code conventions

- **Backend:** PEP 8, type hints on all function signatures, async def for route handlers.
  Dependency injection via `fastapi.Depends`. No global mutable state outside `state.py`.
- **Frontend:** Functional React components, hooks only. Tailwind utility classes. No separate
  CSS files per component. State lives in `App.jsx`; pass props down, lift state up.
- **Commits:** Imperative subject line, body explains *why* not *what*.
- **Imports:** Absolute imports in backend. Relative imports only for co-located helpers in
  frontend.

---

## Common pitfalls

1. **Blocking the WebSocket event loop** — never `await` a slow synchronous operation directly
   in a WebSocket handler. Use `asyncio.to_thread(...)` for CPU-bound or blocking I/O work.

2. **Mutating runtime state without the lock** — `RuntimeSession` uses an `asyncio.Lock` for
   mutation in some paths. Check before adding concurrent writes.

3. **Missing the answer-gating layer** — if you add a new quiz-related API endpoint or WebSocket
   payload, ensure `correct_option_id` is stripped when `answer_revealed` is `False`.

4. **SQLite WAL mode** — the database is opened with `PRAGMA journal_mode=WAL`. Do not open a
   second connection in the same process that overrides this.

5. **Frontend build env vars** — Vite bakes `VITE_*` vars at build time. Runtime env changes
   require a rebuild. Don't confuse `VITE_` (frontend) with plain env vars (backend-only).

6. **Coverage regressions** — adding new code without tests can drop coverage below the gate
   and break CI. Add at least a smoke test for new endpoints or components.

---

## What to update after material changes

1. `AGENTS.md` / this file — if the dev workflow or architecture changes.
2. `.agent/CONTINUITY.md` — append a dated entry describing what changed, why, and where.
3. `README.md` — user-facing feature list and actor use-cases.
4. `docs/ARCHITECTURE.md` — if the system design changes significantly.
5. `backend/.env.example` — if new env vars are introduced.
6. Tests — backend (pytest) and frontend (vitest) must remain above their coverage thresholds.

---

## Quick-reference commands

```bash
# Check everything before pushing
cd backend && python -m compileall app/ && pytest
cd frontend && npm run build && npm run test:coverage

# View recent agent work log
cat .agent/CONTINUITY.md | head -100

# Rebuild and restart containers
docker compose down && docker compose up --build -d
```
