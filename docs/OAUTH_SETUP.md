# OAuth / Social Sign-In Setup

Users can sign in with **GitHub** or **Google** instead of (or alongside) email + password. Both providers are optional — if the credentials are not configured the buttons simply don't work (GitHub returns a 503, Google's button is still rendered but the backend call will fail gracefully with an error message).

---

## How it works

| Provider | Flow |
|----------|------|
| **GitHub** | Server-side redirect — the frontend sends the browser to `/api/auth/oauth/github`, GitHub authenticates the user, then redirects back to the backend callback, which redirects the browser to the frontend with a session token in the URL query string. |
| **Google** | Client-side implicit — `@react-oauth/google` opens a Google popup, the frontend receives an OAuth access token, and sends it to `POST /api/auth/oauth/google` where the backend calls Google's userinfo endpoint to verify it. |

For both providers: if the user's email already exists in the database they are signed in to that existing account. If not, a new account is created automatically with the `teacher` role.

---

## GitHub OAuth

### 1. Create a GitHub OAuth App

1. Go to **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**
2. Fill in:
   - **Application name**: anything (e.g. `VIA Live`)
   - **Homepage URL**: your frontend URL (e.g. `https://vialive.libreuni.com` or `http://localhost:5173` for dev)
   - **Authorization callback URL**: `{BACKEND_URL}/api/auth/oauth/github/callback`
     - Local dev: `http://localhost:9000/api/auth/oauth/github/callback`
     - Production: `https://vialive.libreuni.com/api/auth/oauth/github/callback`
3. Click **Register application**
4. On the app page, copy the **Client ID**
5. Click **Generate a new client secret** and copy it immediately (it won't be shown again)

### 2. Set backend environment variables

Add to `backend/.env`:

```env
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret

# Where GitHub will redirect back after auth (must match the callback URL you registered)
BACKEND_URL=http://localhost:9000

# Where the backend redirects the browser after it processes the callback
FRONTEND_URL=http://localhost:5173
```

For production, replace both URLs with your actual domain(s). If backend and frontend share the same domain (via reverse proxy), both can be `https://vialive.libreuni.com`.

> **Security note:** `GITHUB_CLIENT_SECRET` is a server-side secret. It is read only by the backend and never sent to the browser. Keep it only in `backend/.env` which is gitignored.

---

## Google OAuth

### 1. Create a Google Cloud OAuth Client

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services → Credentials**
2. Click **Create Credentials → OAuth client ID**
3. Choose **Web application**
4. Under **Authorized JavaScript origins** add:
   - `http://localhost:5173` (dev)
   - `https://vialive.libreuni.com` (production)
5. You do **not** need to add a redirect URI for this flow (the frontend handles it via popup)
6. Click **Create** and copy the **Client ID**

> The Google Client ID is **not a secret** — it is embedded in the frontend bundle and visible to anyone. Only the Google Client Secret would be sensitive, and it is not used in this flow.

### 2. Set frontend environment variable

Create (or edit) `frontend/.env`:

```env
VITE_GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
```

This file is gitignored. There is no backend env var needed for Google in the current implementation (the backend verifies tokens via Google's public userinfo endpoint without checking audience).

---

## Local development checklist

```
backend/.env
  GITHUB_CLIENT_ID=...
  GITHUB_CLIENT_SECRET=...
  BACKEND_URL=http://localhost:9000
  FRONTEND_URL=http://localhost:5173

frontend/.env
  VITE_GOOGLE_CLIENT_ID=....apps.googleusercontent.com
```

Start both servers normally:

```bash
make backend-run
make frontend-dev
```

The sign-in page will show **Google** and **GitHub** buttons below the email/password form.

---

## Production (Docker Compose)

For the containerised deployment the backend is not directly reachable from the internet — it sits behind the `web` Nginx container.

**GitHub callback** — no Nginx change needed. The existing `location /api/` block in `frontend/nginx.conf` already proxies the callback path (`/api/auth/oauth/github/callback`) to the backend.

Set in `backend/.env`:

```env
BACKEND_URL=https://vialive.libreuni.com
FRONTEND_URL=https://vialive.libreuni.com
```

**Google** — `VITE_GOOGLE_CLIENT_ID` must be set at **build time** since Vite bakes it into the static bundle. Both `frontend/Dockerfile` and `docker-compose.yml` already have the build arg wired up. Just export the variable on the server before building:

```bash
export VITE_GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
docker compose up -d --build web
```

Or add it to the server's shell profile / CI secret so it is available whenever you rebuild.

---

## Troubleshooting

| Symptom | Likely cause |
|---------|-------------|
| GitHub button redirects but comes back with `oauth_error=not_configured` | `GITHUB_CLIENT_ID` or `GITHUB_CLIENT_SECRET` is empty in `backend/.env` |
| GitHub callback returns 404 | `BACKEND_URL` doesn't match where the backend is actually reachable, or Nginx isn't proxying the callback path |
| GitHub callback URL mismatch error from GitHub | The registered callback URL in the GitHub OAuth App doesn't match `{BACKEND_URL}/api/auth/oauth/github/callback` |
| Google popup opens but sign-in fails with backend error | `VITE_GOOGLE_CLIENT_ID` is not set — the frontend sends an empty client ID to Google which rejects the popup |
| Google sign-in fails with a 401 from the backend | The access token expired before reaching the backend (unusual), or Google's userinfo endpoint is unreachable |
| Existing email account can't sign in via OAuth | Not a bug — OAuth sign-in to an existing email-based account works fine; they share the same user record |
