# VIA Live — Scaling Guide

> This document covers realistic scaling paths for VIA Live, from small-classroom MVP to large-institution deployment. Options are organized by **time horizon** (short vs. long term) and **cost** (cheap vs. expensive).

---

## Current Architecture Baseline

VIA Live today runs as a single-server stack:

```
Internet → Caddy (TLS) → Nginx → FastAPI (Uvicorn) → SQLite
                               → coturn (TURN relay)
```

**Current limits (rough estimates):**
| Resource | Capacity | Bottleneck |
|---|---|---|
| Concurrent WebSocket connections | ~500 | Uvicorn single process |
| Simultaneous sessions | ~200 | In-memory `SESSIONS` dict |
| WebRTC relay connections | ~5,000 | coturn single instance |
| DB write throughput | ~100 writes/s | SQLite WAL mode |
| File storage | Local disk | No CDN, single point of failure |

**This is fine for a hackathon pilot** (1–3 classrooms, 30–100 students). It will not survive a university-wide rollout without changes.

---

## Short-Term Scaling (0–3 Months)

*Goal: support a wider pilot — 10–50 concurrent sessions, 500–2,000 students.*

### Cheap Options

#### 1. Vertical Scaling — Resize the Server
**Cost:** €10–€40/month (VPS upgrade)
**Effort:** 30 minutes

The fastest win. Upgrade from a 1-core/1GB droplet to 4-core/8GB. This buys headroom for more concurrent WebSocket connections and faster AI generation without any code changes.

- Recommended minimum for pilot: **4 vCPU, 8GB RAM, 100GB SSD**
- Add a **2–4GB swap file** (use `scripts/setup-server.sh` or see [DEPLOYMENT.md](DEPLOYMENT.md) §2.1)
- Enable **Uvicorn workers**: change `CMD` in [backend/Dockerfile](backend/Dockerfile) from `--workers 1` to `--workers 4` (one per CPU core)

```dockerfile
# backend/Dockerfile — add workers
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]
```

> **Warning:** Multi-worker Uvicorn breaks in-memory session state. Sessions stored in the `SESSIONS` dict in [backend/app/routers/websocket.py](backend/app/routers/websocket.py) are process-local. Adding workers requires a shared session store first (see Redis below).

---

#### 2. Replace SQLite with PostgreSQL
**Cost:** €0 (self-hosted) or €15–€25/month (managed)
**Effort:** 1–2 days

SQLite is excellent for a single writer but degrades under concurrent load. PostgreSQL handles thousands of concurrent connections, supports async drivers natively (via `asyncpg`), and enables multi-instance deployments.

**Migration steps:**
1. Add `asyncpg` and `sqlalchemy[asyncio]` to [backend/requirements.txt](backend/requirements.txt)
2. Update `DATABASE_URL` in [backend/.env](backend/.env) from `sqlite:///./data.sqlite3` to `postgresql+asyncpg://user:pass@db:5432/vialive`
3. Add a `db` service to [docker-compose.yml](docker-compose.yml):

```yaml
db:
  image: postgres:16-alpine
  environment:
    POSTGRES_USER: vialive
    POSTGRES_PASSWORD: ${DB_PASSWORD}
    POSTGRES_DB: vialive
  volumes:
    - postgres_data:/var/lib/postgresql/data
```

4. Run `alembic` migrations or export/import existing SQLite data with `pgloader`

Self-hosted PostgreSQL on the same server is free and dramatically improves write concurrency. Managed options (Supabase free tier, Neon free tier) cost nothing for small workloads.

---

#### 3. Add Redis for Session State
**Cost:** €0 (self-hosted on same server)
**Effort:** 1–2 days

The `SESSIONS` dict in memory is the primary blocker for horizontal scaling. Moving it to Redis allows multiple backend processes — or multiple servers — to share session state.

Add to [docker-compose.yml](docker-compose.yml):
```yaml
redis:
  image: redis:7-alpine
  command: redis-server --maxmemory 512mb --maxmemory-policy allkeys-lru
```

Replace the in-memory dict in [backend/app/routers/websocket.py](backend/app/routers/websocket.py) with a Redis-backed session manager. Use `aioredis` for async access. Session TTLs should match the 90-second rejoin window already implemented.

> This is the single most impactful architectural change before anything else.

---

#### 4. Rate Limiting on WebSocket Events
**Cost:** €0
**Effort:** 4 hours

Students can currently spam confusion signals, break votes, and quiz answers. Add per-participant rate limiting using Redis counters with TTL:

- Confusion signal: max 1 per 10 seconds per participant
- Break vote: already has 30-second cooldown in [backend/app/routers/websocket.py](backend/app/routers/websocket.py) — enforce server-side
- Quiz answer: max 1 per question per participant (idempotent by design, but verify)

This prevents abuse from degrading session quality under real classroom conditions.

---

### Moderate Cost Options

#### 5. Move File Uploads to Object Storage (S3/R2)
**Cost:** ~€0.02/GB/month (Cloudflare R2 is free up to 10GB)
**Effort:** 1 day

Presentation files are currently stored in `backend/uploads/` on local disk. This creates two problems: files are lost if the container is recreated, and the disk fills up.

- Replace local storage with **Cloudflare R2** (free tier, S3-compatible API) or **AWS S3**
- Use `boto3` in [backend/app/routers/presentations.py](backend/app/routers/presentations.py) to upload on ingest and generate presigned URLs for serving
- Remove the bind-mount volume from [docker-compose.yml](docker-compose.yml)

R2 is the cheapest option — no egress fees, S3-compatible, free up to 10GB storage and 1M requests/month.

---

## Long-Term Scaling (3–12 Months)

*Goal: university-wide deployment — 100+ concurrent sessions, 5,000–20,000 students.*

### Cheap-ish Options (Cloud-Native, Managed Services)

#### 6. Containerize with Kubernetes (K8s)
**Cost:** €80–€200/month (managed K8s on Hetzner Cloud or DigitalOcean)
**Effort:** 1–2 weeks

Once Redis holds session state and PostgreSQL holds all data, the FastAPI backend becomes stateless and horizontally scalable. Kubernetes enables:

- **Auto-scaling:** scale backend pods based on CPU/WebSocket connection count
- **Rolling deploys:** zero-downtime deployments (critical for live sessions)
- **Self-healing:** automatic pod restarts on crash

The existing [docker-compose.yml](docker-compose.yml) can be converted to Kubernetes manifests with `kompose convert` as a starting point.

Managed K8s options by cost:
| Provider | Price/month | Notes |
|---|---|---|
| Hetzner Cloud (k3s) | €20–€60 | Cheapest managed K8s in Europe |
| DigitalOcean DOKS | €80–€150 | Simple UX, good docs |
| OVHCloud | €50–€100 | EU data residency |
| AWS EKS | €150–€400+ | Most features, highest cost |

---

#### 7. Async AI Queue with Celery + Redis
**Cost:** €0 (reuses Redis)
**Effort:** 1–2 days

Quiz generation currently blocks for up to 45 seconds while waiting for Gemini. Under load, this ties up a Uvicorn worker and degrades the WebSocket experience.

Replace synchronous AI calls in [backend/app/services/ai.py](backend/app/services/ai.py) with a Celery task queue:

```python
# Dispatch async
task = generate_quiz.delay(session_code, notes_content, style)

# Frontend polls or receives result via WebSocket push when ready
```

Add a Celery worker container to [docker-compose.yml](docker-compose.yml):
```yaml
celery-worker:
  build: ./backend
  command: celery -A app.celery worker --loglevel=info --concurrency=4
  depends_on: [redis, db]
```

This frees WebSocket workers from AI latency and allows quiz generation to retry on failure.

---

#### 8. Geo-Distributed TURN Servers
**Cost:** €10–€20/month per region
**Effort:** 2–4 hours per region

The self-hosted coturn container runs in one datacenter. Students connecting from far away get high-latency WebRTC relay, degrading screen-share quality.

- Deploy coturn on **2–3 regional VPS instances** (e.g., Frankfurt, Stockholm, Copenhagen for VIA's target audience)
- Update `VITE_RTC_ICE_SERVERS` in the frontend to include all TURN servers
- The WebRTC stack will automatically select the lowest-latency relay

Alternatively, use **Twilio TURN** (pay-per-minute) or **Metered.ca** (free tier: 50GB/month) for a fully managed TURN service without self-hosting overhead.

---

### Expensive / Enterprise Options

#### 9. Outsource WebRTC to a Media Server (LiveKit or mediasoup)
**Cost:** €200–€2,000/month (hosted) or €80–€300/month (self-hosted)
**Effort:** 1–3 weeks

The current architecture uses browser-to-browser P2P WebRTC with a TURN relay fallback. This works fine for 1 teacher sharing to 30 students. It breaks down when:
- Students have poor NAT/firewall environments
- The teacher wants to share to 100+ students simultaneously
- You need recording, transcription, or server-side video processing

**LiveKit** is the recommended replacement:
- Open source SFU (Selective Forwarding Unit) — the server routes video between participants
- Scales to thousands of viewers per room
- Self-hosted on a dedicated 4-core server or via LiveKit Cloud (~$0.006/participant-minute)
- Drop-in React SDK to replace the custom WebRTC code in [frontend/src/App.jsx](frontend/src/App.jsx)

```
Teacher → LiveKit SFU → All Students (server-fan-out, not P2P)
```

This eliminates the coturn dependency entirely and adds features like recording, adaptive bitrate, and server-side composition.

---

#### 10. CDN for Static Assets
**Cost:** €0–€20/month
**Effort:** 2–4 hours

The React frontend is currently served by Nginx from the same server as the backend. Under heavy traffic, static file serving competes with API/WebSocket processing.

- Push the Vite build output to **Cloudflare Pages** (free) or **AWS CloudFront**
- Update the Caddyfile to route `/` to the CDN and only proxy `/api` and `/ws` to the backend
- Assets are then served from edge nodes globally with sub-50ms TTFB

For VIA (primarily Danish users), Cloudflare Pages free tier is sufficient and requires zero infrastructure changes — just a GitHub Actions step to deploy on push to main.

---

#### 11. Managed Database — Supabase or Neon
**Cost:** €0–€50/month
**Effort:** 4–8 hours

For a university deployment, self-managing PostgreSQL adds operational risk (backups, replication, failover). Managed database services handle this:

| Service | Free Tier | Paid | Notes |
|---|---|---|---|
| Supabase | 2 projects, 500MB | $25/month | Adds Auth, Realtime, Storage APIs |
| Neon | 0.5GB | $19/month | Serverless PostgreSQL, branching |
| PlanetScale | N/A | $39/month | MySQL only |
| AWS RDS | — | €60–€200/month | Most reliable, most expensive |

Supabase is attractive because it could replace the custom auth system in [backend/app/routers/auth.py](backend/app/routers/auth.py) and the file storage in [backend/app/routers/presentations.py](backend/app/routers/presentations.py), reducing backend complexity significantly.

---

#### 12. Outsource AI to a Managed Inference Endpoint
**Cost:** $0.002–$0.05 per quiz generation (API pricing)
**Effort:** Already done — Gemini API is external

The AI integration in [backend/app/services/ai.py](backend/app/services/ai.py) already calls Gemini externally. The main scaling concern is:

- **Rate limits:** Gemini free tier limits concurrent requests; upgrade to a paid plan or add request queuing
- **Latency:** Cache quiz results by content hash (already implemented via `ai_cache` table) — extend TTL from session to persistent
- **Cost control:** Add a per-teacher daily generation limit in the database to prevent runaway API costs

For enterprise volume, consider **Azure OpenAI** (predictable EU pricing, GDPR-compliant data residency) or **Vertex AI** (Gemini with SLAs and dedicated throughput).

---

## Scaling Decision Matrix

| Scenario | Users | Recommended Path | Estimated Monthly Cost |
|---|---|---|---|
| Hackathon / pilot | <200 | Current stack + vertical resize | €10–€20 |
| Department rollout | 200–1,000 | + PostgreSQL + Redis + workers | €30–€60 |
| University pilot | 1,000–5,000 | + Kubernetes + Celery + CDN | €100–€250 |
| Full university | 5,000–20,000 | + LiveKit + managed DB + TURN fleet | €400–€1,000 |
| Multi-institution | 20,000+ | Dedicated cloud infrastructure + SLAs | €2,000+ |

---

## Priority Order for Next Steps

Given that VIA Live is post-hackathon and moving toward a real pilot, the recommended sequence is:

1. **PostgreSQL** — removes the biggest structural limitation, enables everything else
2. **Redis session store** — unlocks horizontal scaling and multi-worker Uvicorn
3. **Uvicorn multi-worker** — immediate throughput gain with zero new infrastructure
4. **Cloudflare R2 for uploads** — eliminates disk dependency, free at pilot scale
5. **Cloudflare Pages for frontend** — free CDN, removes static file load from server
6. **Celery + async AI** — better UX under load, enables retry logic
7. **LiveKit** — when WebRTC reliability becomes a complaint or recording is needed
8. **Kubernetes** — when deployment complexity or auto-scaling becomes necessary

Each step is independently deployable and builds on the previous without requiring a full rewrite.

---

## What NOT to Do (Yet)

- **Microservices:** The codebase is too small. Splitting into auth-service, session-service, etc. adds operational overhead with no benefit at this scale.
- **GraphQL:** REST + WebSocket is already the right protocol split for this app.
- **Custom analytics warehouse:** Use the existing PostgreSQL event log with a BI tool (Metabase, Grafana) before building a data pipeline.
- **Rewrite the frontend in Next.js/SSR:** The React SPA is fine; rendering is client-side by design (WebSocket-heavy, not SEO-dependent).

---

## Deployment Blueprints by Provider

Rather than picking individual services à la carte, these blueprints show coherent setups where everything lives together on one provider (or a tight combination). Pick the one that matches your budget and comfort level.

---

### Blueprint A — Single Hetzner VPS (Cheapest, €15–30/mo)

Everything on one server. Simple ops, no managed services. Good for pilot deployments up to ~500 concurrent students.

```
┌─────────────────────────────────────────────────────────────┐
│  Hetzner CX22 (4 vCPU, 8GB RAM, 80GB SSD) ~€15/mo          │
│                                                             │
│  Docker Compose stack:                                      │
│  ├── caddy         (TLS termination)                        │
│  ├── nginx         (static files + reverse proxy)           │
│  ├── fastapi       (4 Uvicorn workers)                      │
│  ├── postgresql    (replaces SQLite)                        │
│  ├── redis         (session state + Celery broker)          │
│  ├── celery-worker (async AI jobs)                          │
│  └── coturn        (WebRTC TURN relay)                      │
│                                                             │
│  Storage: Hetzner Volume (20GB, €1/mo) for uploads         │
└─────────────────────────────────────────────────────────────┘
```

**What runs together:** PostgreSQL + Redis share the same host as the app. This is safe at this scale — 8GB RAM is plenty for both alongside FastAPI.

**Tradeoffs:**
- No redundancy — if the VPS goes down, everything goes down
- Manual backups (add a daily `pg_dump` cron to Hetzner Object Storage)
- Works well up to ~500 concurrent users before CPU becomes the bottleneck

**Setup:**
1. Run `scripts/setup-server.sh` on the fresh VPS
2. Add `db` (PostgreSQL) and `redis` services to [docker-compose.yml](docker-compose.yml)
3. Add `celery-worker` service pointing to the same image as `backend`
4. Update `DATABASE_URL` in `backend/.env` to `postgresql+asyncpg://...@db:5432/vialive`

---

### Blueprint B — Hetzner VPS + Object Storage (€25–50/mo)

Same single-server approach but with file uploads offloaded to Hetzner Object Storage (S3-compatible). Removes the local disk dependency and makes the app server stateless enough for a simple failover.

```
┌──────────────────────────────────────────┐     ┌──────────────────────┐
│  Hetzner CX32 (4 vCPU, 8GB RAM) ~€20/mo  │     │  Hetzner Object      │
│                                          │────▶│  Storage (S3-compat) │
│  Docker Compose:                         │     │  ~€6/mo (100GB)      │
│  ├── caddy                               │     └──────────────────────┘
│  ├── nginx
│  ├── fastapi (4 workers)                 │     ┌──────────────────────┐
│  ├── postgresql                          │     │  Hetzner DNS         │
│  ├── redis                               │     │  (free with account) │
│  ├── celery-worker                       │     └──────────────────────┘
│  └── coturn                              │
└──────────────────────────────────────────┘
```

**Key addition:** Replace the local `backend/uploads/` volume with `boto3` calls to Hetzner Object Storage using the S3-compatible endpoint (`s3.eu-central-003.backblazeb2.com` style). Same code change as AWS S3, different endpoint URL.

**Tradeoffs:**
- Uploads survive server rebuilds or migrations
- Still a single app server — not horizontally scalable yet
- Hetzner Object Storage egress to Hetzner VPS is free within same region

---

### Blueprint C — Two Hetzner Servers + Private Network (€40–80/mo)

Split app server from data server. The app server is now replaceable without touching the database.

```
┌──────────────────────────────┐   Private    ┌─────────────────────────────┐
│  App Server (CX22, ~€15/mo)  │   Network    │  DB Server (CX21, ~€5/mo)  │
│                              │◀────────────▶│                             │
│  ├── caddy                   │  10.0.0.x    │  ├── postgresql             │
│  ├── nginx                   │              │  └── redis                  │
│  ├── fastapi (4 workers)     │              │                             │
│  ├── celery-worker           │              │  Hetzner Volume (20GB)      │
│  └── coturn                  │              │  for PG data dir            │
└──────────────────────────────┘              └─────────────────────────────┘
                                                         │
                                              ┌──────────▼──────────┐
                                              │  Hetzner Object     │
                                              │  Storage (uploads)  │
                                              └─────────────────────┘
```

**Hetzner private network** is free and provides low-latency, isolated communication between VMs in the same project. PostgreSQL and Redis are not exposed to the public internet.

**Tradeoffs:**
- Can rebuild/replace the app server without touching data
- DB server is still a single point of failure (add Hetzner managed PostgreSQL at €25/mo for HA)
- Good for up to ~2,000 concurrent users

---

### Blueprint D — Hetzner Managed Services Stack (€80–150/mo)

Use Hetzner's managed offerings to reduce ops burden. Hetzner now offers **Managed Databases** (PostgreSQL) and **Load Balancers**, making it possible to run a proper HA stack entirely within Hetzner.

```
                        ┌──────────────────────┐
                        │  Hetzner Load        │
     Internet ─────────▶│  Balancer (~€6/mo)   │
                        └──────────┬───────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
  ┌───────────────────┐ ┌───────────────────┐          ...
  │  App Server #1    │ │  App Server #2    │  (scale out as needed)
  │  CX22, ~€15/mo    │ │  CX22, ~€15/mo    │
  │                   │ │                   │
  │  ├── fastapi      │ │  ├── fastapi      │
  │  ├── celery       │ │  ├── celery       │
  │  └── coturn       │ │  └── coturn       │
  └───────────────────┘ └───────────────────┘
              │                    │
              └──────────┬─────────┘
                         │  Private Network
              ┌──────────▼──────────┐    ┌──────────────────────┐
              │  Hetzner Managed    │    │  Redis (CX11,        │
              │  PostgreSQL         │    │  self-hosted, ~€5/mo)│
              │  (~€25/mo, HA)      │    └──────────────────────┘
              └─────────────────────┘
                         │
              ┌──────────▼──────────┐
              │  Hetzner Object     │
              │  Storage (uploads)  │
              └─────────────────────┘
```

**Prerequisites:** Redis must be in session store before this works (Blueprint A/B prerequisite). Frontend served from Cloudflare Pages (free) to keep Nginx off the app servers.

**Tradeoffs:**
- Horizontally scalable app layer (add/remove servers via Hetzner API)
- Hetzner Managed PostgreSQL handles backups, failover, minor version upgrades
- Still all EU-based (GDPR friendly for VIA/Danish data)
- Redis is still self-hosted — Hetzner doesn't offer managed Redis yet

---

### Blueprint E — Cloudflare + Hetzner Hybrid (€30–60/mo, best value)

Leverage Cloudflare's free tier for everything it handles well (CDN, DDoS, DNS, frontend hosting), keep the backend on a single cheap Hetzner server.

```
  Students/Teachers
        │
        ▼
  ┌─────────────────────────────────────────────────────────┐
  │  Cloudflare (free tier)                                 │
  │  ├── DNS (authoritative, free)                          │
  │  ├── DDoS protection (free)                             │
  │  ├── Pages → serves React frontend (free, global CDN)   │
  │  └── Proxied A record → Hetzner server                  │
  └───────────────────────────────┬─────────────────────────┘
                                  │ (only /api and /ws pass through)
                                  ▼
  ┌──────────────────────────────────────────────────────┐
  │  Hetzner CX32 (4 vCPU, 8GB) ~€20/mo                  │
  │                                                      │
  │  Docker Compose:                                     │
  │  ├── caddy (TLS — or Cloudflare handles TLS)         │
  │  ├── fastapi (4 workers)                             │
  │  ├── postgresql                                      │
  │  ├── redis                                           │
  │  ├── celery-worker                                   │
  │  └── coturn (direct, not through Cloudflare)         │
  └──────────────────────────────────────────────────────┘
        │
        ▼
  ┌─────────────────────────┐
  │  Cloudflare R2          │
  │  (uploads, free 10GB)   │
  └─────────────────────────┘
```

> **Note on WebRTC + Cloudflare proxy:** TURN/coturn traffic must bypass Cloudflare (it's not HTTP). Point `turn.vialive.libreuni.com` as a DNS-only record (grey cloud) directly to the server IP. The app domain can stay orange-cloud proxied.

**Tradeoffs:**
- Frontend loads from Cloudflare edge, ~50ms anywhere in the world
- R2 storage has no egress fees (unlike S3)
- Zero cost for CDN, DDoS protection, DNS
- Still a single backend server — add Blueprint C/D for HA

---

### Blueprint F — Fully Managed / No-Ops (€100–200/mo)

For teams who want to focus entirely on code and not infrastructure. Every component is a managed service with an SLA.

| Component | Service | Cost/mo |
|---|---|---|
| Backend hosting | **Railway** or **Render** (Docker deploy) | €20–50 |
| PostgreSQL | **Neon** serverless (scales to zero) | €19 |
| Redis | **Upstash** serverless Redis | €0–10 |
| File storage | **Cloudflare R2** | €0–5 |
| Frontend | **Cloudflare Pages** | €0 |
| TURN relay | **Metered.ca** (managed coturn) | €0–20 (50GB free) |
| AI (Gemini) | Google AI Studio / Vertex AI | €5–30 |

**Architecture:**
```
Cloudflare Pages → (static frontend)
      +
Railway/Render → FastAPI container (auto-deploys from GitHub)
      ↓
Neon PostgreSQL + Upstash Redis (serverless, scale to zero)
      ↓
Cloudflare R2 (uploads)
      +
Metered.ca TURN (no coturn to manage)
```

**Tradeoffs:**
- Zero server management — no SSH, no Docker, no swap files
- Each service bills independently; costs spike on traffic spikes
- Railway/Render cold-start latency if the app idles (set min instances = 1)
- Some services are US-hosted — check GDPR requirements for VIA/Danish student data
- Neon/Upstash are GDPR-compliant with EU regions available
