const explicitApiBase = (import.meta.env.VITE_API_BASE || '').trim()
const devApiTarget = (import.meta.env.VITE_DEV_API_TARGET || '').trim()
const explicitRtcIceServers = (import.meta.env.VITE_RTC_ICE_SERVERS || '').trim()

const fallbackIceServers = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  }
]

function inferApiBase() {
  if (explicitApiBase) return explicitApiBase

  if (typeof window === 'undefined') {
    return devApiTarget || 'http://localhost:9000'
  }

  // In browser, default to same-origin so `/api` and `/ws` are routed by proxy/reverse proxy.
  return ''
}

const API_BASE = inferApiBase()

function inferWsBase() {
  if (API_BASE) return API_BASE.replace(/^http/, 'ws')
  if (typeof window === 'undefined') return 'ws://localhost:9000'
  return `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`
}

function normalizeIceServer(server) {
  if (!server || typeof server !== 'object') return null

  let urls = null
  if (typeof server.urls === 'string' && server.urls.trim()) {
    urls = server.urls.trim()
  } else if (Array.isArray(server.urls)) {
    const filtered = server.urls
      .filter((value) => typeof value === 'string' && value.trim())
      .map((value) => value.trim())
    if (filtered.length) {
      urls = filtered
    }
  }

  if (!urls) return null

  const normalized = { urls }
  if (typeof server.username === 'string' && server.username.trim()) {
    normalized.username = server.username.trim()
  }
  if (typeof server.credential === 'string' && server.credential.trim()) {
    normalized.credential = server.credential.trim()
  }
  return normalized
}

function inferRtcIceServers() {
  if (!explicitRtcIceServers) return fallbackIceServers

  try {
    const parsed = JSON.parse(explicitRtcIceServers)
    if (!Array.isArray(parsed)) return fallbackIceServers

    const normalized = parsed.map(normalizeIceServer).filter(Boolean)
    return normalized.length ? normalized : fallbackIceServers
  } catch {
    return fallbackIceServers
  }
}

export const config = {
  apiBase: API_BASE,
  wsBase: inferWsBase(),
  rtcConfig: {
    iceServers: inferRtcIceServers(),
  },
}
