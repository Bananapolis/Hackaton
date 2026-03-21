const explicitApiBase = (import.meta.env.VITE_API_BASE || '').trim()
const devApiTarget = (import.meta.env.VITE_DEV_API_TARGET || '').trim()

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

export const config = {
  apiBase: API_BASE,
  wsBase: inferWsBase(),
}
