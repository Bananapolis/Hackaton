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
- Decided MVP AI input source is **teacher-provided notes** (not audio transcription or image analysis) for reliability in a 24h window.
