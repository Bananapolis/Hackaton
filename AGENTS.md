# Agent Guidelines — Live Pulse

> For Claude Code specifically, also read [CLAUDE.md](CLAUDE.md) — it contains the full
> architectural overview, dev commands, and common pitfalls.

---

## Orientation

Read [README.md](README.md) at the start of any session and whenever you need context about
features or actors. Read [CLAUDE.md](CLAUDE.md) for technical onboarding (repo layout, how to
run, how to test, architecture decisions).

---

## Editing files

- Make the smallest safe change that solves the issue.
- Preserve existing style and conventions (see CLAUDE.md → "Code conventions").
- Prefer patch-style edits (small, reviewable diffs) over full-file rewrites.
- After making changes, run the project's standard checks when feasible:
  - Backend: `python -m compileall app/` then `pytest`
  - Frontend: `npm run build` then `npm run test:coverage`

---

## Reading project documents (PDFs, uploads, long text, CSVs, etc.)

- Read the full document first.
- Draft the output.
- **Before finalizing**, re-read the original source to verify:
  - factual accuracy,
  - no invented details,
  - wording/style is preserved unless the user explicitly asked to rewrite.
- If paraphrasing is required, label it explicitly as a paraphrase.

---

## Architecture guardrails

- **Do not block the WebSocket event loop.** Wrap blocking/CPU-bound calls in
  `asyncio.to_thread(...)`. See the AI quiz generation in `backend/app/services/ai.py` as the
  reference pattern.
- **Do not expose quiz answers prematurely.** Any endpoint or WebSocket payload that includes
  quiz data must strip `correct_option_id` when `answer_revealed` is `False`.
- **Runtime state lives in `state.py`, durable state lives in SQLite.** Do not cache durable
  data in runtime state or vice versa.

---

## Definition of done

A task is done when:

- The requested change is implemented or the question is answered.
- Verification is provided:
  - build attempted (when source code changed),
  - linting / compile check run (when source code changed),
  - errors/warnings addressed (or explicitly listed and agreed as out-of-scope),
  - tests run and passing (backend ≥ 85 %, frontend ≥ 75 % coverage).
- Documentation is updated for impacted areas:
  - `README.md` for user-visible features,
  - `backend/.env.example` for new env vars,
  - `docs/` for architectural changes.
- Impact is explained (what changed, where, why).
- Follow-ups are listed if anything was intentionally left out.
- `.agent/CONTINUITY.md` is updated if the change materially affects goals, state, or decisions.

---

# Golden Rule

Do not claim a task is done if the app does not run or tests do not pass.
