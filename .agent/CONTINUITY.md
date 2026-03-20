# Continuity Log

## 2026-03-20

- Bootstrapped the full MVP system from scratch in this repository.
- Added backend service in [backend/app/main.py](backend/app/main.py) with:
  - session creation,
  - WebSocket room handling,
  - WebRTC signaling relay,
  - confusion and break-vote metrics,
  - break cooldown and threshold logic,
  - teacher notes broadcast,
  - AI/fallback quiz generation,
  - in-memory analytics + SQLite event persistence.
- Added frontend app in [frontend/src/App.jsx](frontend/src/App.jsx) using React + Tailwind with teacher/student flows.
- Added build and run structure:
  - [backend/requirements.txt](backend/requirements.txt)
  - [frontend/package.json](frontend/package.json)
  - [Makefile](Makefile)
- Updated quiz generation input to **shared-screen screenshot + teacher notes**.
- Added support for OpenAI-compatible providers via optional `OPENAI_BASE_URL`.
- Added student-side quiz answer confirmation state to make quiz voting feedback explicit.
- Switched AI integration priority to **Gemini API first** (`GEMINI_API_KEY`/`GEMINI_MODEL`), with OpenAI-compatible fallback retained.
- Hardened secret hygiene for public repo: expanded `.gitignore` for env/key files and documented explicit secret-removal/rotation steps in README.
- Removed silent quiz fallback behavior: AI generation failures now return explicit teacher-visible errors and no new quiz is broadcast.
- Updated Gemini default model to `gemini-2.5-flash` and added automatic retry on that model when configured Gemini model is deprecated/unavailable.
