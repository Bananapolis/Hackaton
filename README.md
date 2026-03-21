# Project Documentation: Real-Time Educational Engagement Platform (MVP)

## 1. Executive Summary

This project is a browser-based, live screen-sharing application designed to solve the lack of student engagement and accommodate shy students in educational settings. Tailored for the faculty at VIA University College, the platform overlays real-time, anonymous student feedback (confusion alerts, break requests) and AI-generated interactive elements (quizzes) directly onto a live presentation feed.

**Primary Objective:** Deliver a fully functional, deployed Minimum Viable Product (MVP) within a 24-hour hackathon timeframe.

## 1.1 Current Repository Status

This repository now contains a complete MVP implementation with:

- **Backend:** FastAPI + WebSocket signaling + SQLite persistence
- **Frontend:** React + Tailwind + browser WebRTC integration
- **Core flows:** teacher session creation, student join by code, live screen sharing, engagement metrics, break voting, notes, quiz generation, and analytics snapshot.
- **Core flows:** teacher session creation, student join by code, live screen sharing, engagement metrics, break voting, notes, quiz generation, student "explain the screen" AI help, and analytics + class awards snapshot.
- **Teacher awareness:** browser desktop notifications when confusion level is high or break-vote threshold is reached (when notification permission is granted)
- **Core flows:** teacher session creation, student join by code, live screen sharing, engagement metrics, break voting, notes, quiz generation, and analytics snapshot
- **Core flows:** teacher session creation, student join by code, live screen sharing, engagement metrics, break voting, notes, quiz generation, analytics snapshot, and session end with downloadable full engagement report

## 2. Technical Architecture & Recommended Stack

To achieve a live-sharing Kahoot/Google Meet hybrid in 24 hours, the architecture must prioritize low latency and rapid development.

* **Real-Time Communication (Screen Sharing):** WebRTC. Essential for browser-to-browser, low-latency video feeds.
* **Real-Time Data (State/Engagement):** WebSockets (e.g., Socket.io or standard WebSockets). Required for instant break requests, confusion alerts, and quiz triggers without polling the database.
* **Frontend:** React with Tailwind
* **Backend:** Python with FastAPI
* **AI Integration:** Gemini API (primary) with OpenAI-compatible fallback support. Used to generate a 1-question quiz with 4 options from current notes.
* **Database:** SQLite or PostgreSQL. For a 24h MVP, SQLite is sufficient to store session data, attendance, and basic statistics.

## 2.1 Implemented Architecture (Actual)

### Backend (FastAPI)

- `POST /api/sessions` creates a teacher session and join code.
- `GET /api/sessions/{code}/analytics` returns current analytics for active sessions.
- `POST /api/auth/register` and `POST /api/auth/login` create/sign in accounts and return auth tokens.
- `GET /api/auth/me` returns the authenticated profile.
- `GET /api/library/sessions` returns historical sessions for the authenticated teacher name.
- `POST /api/presentations`, `GET /api/presentations`, and `GET /api/presentations/{id}/download` manage uploaded presentation files per account.
- `POST /api/presentations/{id}/notes-png` generates student-friendly AI notes from a presentation and returns a downloadable PNG.
- `POST /api/quizzes/save` and `GET /api/quizzes` manage a per-account quiz library.
- `GET /health` provides health status.
- `WS /ws/{code}?role=teacher|student&name=...` handles:
	- participant joins/leaves,
	- full session-state sync on connect (notes, break timer, quiz state, metrics),
	- WebRTC signal relay (`offer`/`answer`/`ICE`),
	- per-student confusion signals with automatic level decay over time,
	- break votes with cooldown,
	- teacher-triggered break timer,
	- note updates,
	- AI quiz generation and answer tracking,
	- teacher analytics updates.

SQLite stores:

- `sessions` table (session lifecycle metadata)
- `events` table (append-only event log)
- `users` + `auth_tokens` tables (account and token-based auth)
- `presentations` table (uploaded files metadata)
- `saved_quizzes` table (stored quiz library entries)

### Frontend (React + Tailwind)

- Single-page app with role switch (teacher/student).
- Account-first access: users register/login once, then choose whether to host a new session or join an existing one from session settings.
- Stream-first layout with minimal always-on UI and on-demand layered panels.
- Icon-first controls for high-frequency actions with hover tooltips.
- Theme toggle (dark/light) with persisted user preference (default: light).
- Session settings persistence for role, name, and last session code across browser restarts.
- Account authentication (register/login) before entering the live classroom workspace.
- Session join URL supports `?code=ABC123` prefill for student devices.
- Teacher stage includes a large on-screen QR code that encodes the student join URL.
- Teacher can:
	- create session,
	- join and share screen,
	- write/push notes,
	- generate quiz (with AI prompt presets like default/funny/challenge and optional custom instruction),
	- start synchronized break and manage it live (extend/reduce by 1 minute, cancel/end now),
	- open a trophy-based class awards modal with rankings like most active student and most correct answers.
	- open a sessions/files/quizzes library panel,
	- upload and download presentation files,
	- generate student-friendly notes PNG from uploaded presentation files via AI,
	- save live generated quizzes into a persistent account-level quiz library.
- Student can:
	- join via session code,
	- receive teacher stream,
	- submit confusion signal,
	- vote for break,
	- answer quiz.

UX design rationale for this iteration is documented in [frontend/UX-OVERHAUL.md](frontend/UX-OVERHAUL.md).

### AI Implementation Choice

For this MVP, quiz generation input is:

1. **Teacher notes text**.

Quiz prompts include guardrails so answer correctness should not be obvious from option length, formatting, or wording style alone.

The backend sends notes to Gemini when configured.

## 3. Actor Analysis & Use Cases

### Actor 1: Teacher (Host)

* **UC-T1: Screen Management:** Initialize session, generate join code, share screen, freeze screen, pause sharing, and modify session settings.
* **UC-T2: Engagement Monitoring:** Receive non-intrusive UI alerts and browser desktop notifications when confusion gets high or students request a break. View real-time aggregated engagement metrics.
* **UC-T3: AI Quiz Generation:** Trigger a single-button action to generate a contextual multiple-choice question (4 options). Push the question as a global overlay to all connected students.
* **UC-T4: Break Management:** Initiate a synchronized break timer manually or accept a break prompt triggered by student thresholds. During break, adjust time (+/- 1 minute), end immediately, and display both countdown and "be back at" time.
* **UC-T5: Note Distribution:** Create and push shared text notes to the student interface during the live session.
* **UC-T6: Analytics & Awards Dashboard:** Access post-session statistics, including attendance, aggregate engagement levels, quiz accuracy, class awards (e.g. most active student / most correct answers), and exported notes.
* **UC-T6: Analytics Dashboard:** Access post-session statistics, including attendance, aggregate engagement levels, quiz accuracy, and exported notes.
* **UC-T7: Session Closure & Report Export:** End the live session from settings and download a full analytics report (JSON) with engagement score, participation rates, and quiz outcomes.

### Actor 2: Student (Client)

* **UC-S1: Session Access:** Join the live session via browser using the teacher's code. View the live screen share.
* **UC-S2: Confusion Reporting:** Click a button to anonymously raise personal confusion level (capped per student). The level decays automatically over time so teacher sees live classroom confusion intensity instead of unlimited alert accumulation.
* **UC-S3: Break Request:** Click a button to vote for a break. *Constraint:* Must be governed by a rate-limiting cooldown mechanism to prevent spam.
* **UC-S4: Quiz Participation:** Receive and interact with the pop-up quiz overlay, selecting one of the 4 generated options.
* **UC-S5: Break Interface:** View the synchronized countdown timer indicating when the session resumes.
* **UC-S6: Screen Explanation Help:** Click an "Explain the screen" action to receive a concise AI explanation of the current shared screen and what to focus on next.

## 4. Repository Layout

```text
.
├── backend/
│   ├── app/
│   │   └── main.py
│   ├── .env.example
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── App.jsx
│   │   ├── config.js
│   │   ├── main.jsx
│   │   └── styles.css
│   ├── index.html
│   ├── package.json
│   ├── postcss.config.js
│   ├── tailwind.config.js
│   └── vite.config.js
├── .agent/CONTINUITY.md
├── .gitignore
├── Makefile
├── AGENTS.md
└── README.md
```

## 5. Local Development (Nobara/Fedora)

### 5.1 Prerequisites

- Python 3.11+
- Node.js 20+
- npm

### 5.2 Backend setup

1. Create and activate a Python virtual environment in `backend/`.
2. Install dependencies from `backend/requirements.txt`.
3. Copy `backend/.env.example` to `backend/.env` and configure values.
4. Run backend:

```bash
make backend-run
```

Backend default URL: `http://localhost:8000`

### 5.3 Frontend setup

1. Install dependencies:

```bash
make frontend-install
```

2. Run dev server:

```bash
make frontend-dev
```

Frontend default URL: `http://localhost:5173`

If backend is not on `http://localhost:8000`, set `VITE_API_BASE` in frontend environment.

### 5.4 Build checks

- Backend syntax check:

```bash
make backend-check
```

- Frontend production build:

```bash
make frontend-build
```

## 6. Deployment Protocol

Containerized deployment is now included for Ubuntu servers.

- Compose setup: [docker-compose.yml](docker-compose.yml)
- Backend image: [backend/Dockerfile](backend/Dockerfile)
- Frontend + reverse proxy image: [frontend/Dockerfile](frontend/Dockerfile) and [frontend/nginx.conf](frontend/nginx.conf)
- Full step-by-step runbook: [DEPLOYMENT.md](DEPLOYMENT.md)
- Starter CI/CD pipeline: [.github/workflows/deploy.yml](.github/workflows/deploy.yml)

For production demos, HTTPS remains mandatory for reliable WebRTC behavior.

### AI Provider Setup

Create `backend/.env` from `backend/.env.example` and set:

- `GEMINI_API_KEY` = your Gemini API key
- `GEMINI_MODEL` = e.g. `gemini-2.5-flash`

Optional fallback:

- `OPENAI_API_KEY` = your provider key
- `OPENAI_MODEL` = a model that supports text+image input
- `OPENAI_BASE_URL` = optional OpenAI-compatible base URL

Examples:

- Gemini (recommended): set `GEMINI_API_KEY`, keep `GEMINI_MODEL=gemini-2.5-flash`

- OpenAI (paid): leave `OPENAI_BASE_URL` empty
- OpenRouter/Groq-compatible endpoint: set `OPENAI_BASE_URL` to their OpenAI-compatible URL and use a supported model string

Priority order is: Gemini first, then OpenAI-compatible. If generation fails, the teacher gets an explicit error and no new quiz is broadcast.

### Public Repo Secret Safety (Required)

- Never commit real API keys.
- Keep secrets only in local `backend/.env` (already ignored by git).
- Keep `backend/.env.example` with empty placeholders only.

If a secret was accidentally staged/tracked, remove it immediately:

```bash
git rm --cached backend/.env
```

Then rotate the exposed key in the provider dashboard.

# 7. Implementation notes

Should be extremely simple to deploy. Everything must be in this one repository, ideally split into folders that make sense.

---
