const explicitApiBase = (import.meta.env.VITE_API_BASE || '').trim()
const devApiTarget = (import.meta.env.VITE_DEV_API_TARGET || '').trim()

function inferApiBase() {
  if (explicitApiBase) return explicitApiBase

  // In Vite dev, prefer same-origin and let the dev proxy route API and WS.
  if (import.meta.env.DEV) {
    return ''
  }

  if (typeof window === 'undefined') {
    return devApiTarget || 'http://localhost:8000'
  }

  const { protocol, hostname, host, port } = window.location

  // When not using proxy and opened from a dev host, keep same host on backend port.
  if (port === '5173' || port === '4173') {
    return `${protocol}//${hostname}:8000`
  }

  // In deployment, prefer same-origin unless explicitly overridden.
  return `${protocol}//${host}`
}

const API_BASE = inferApiBase()

function inferWsBase() {
  if (API_BASE) return API_BASE.replace(/^http/, 'ws')
  if (typeof window === 'undefined') return 'ws://localhost:8000'
  return `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`
}

export const config = {
  apiBase: API_BASE,
  wsBase: inferWsBase(),
}
