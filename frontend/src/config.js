const explicitApiBase = (import.meta.env.VITE_API_BASE || '').trim()

function inferApiBase() {
  if (explicitApiBase) return explicitApiBase

  if (typeof window === 'undefined') {
    return 'http://localhost:8000'
  }

  const { protocol, hostname, host, port } = window.location

  // Vite dev server is usually 5173/4173. Keep same host, switch to backend port.
  if (port === '5173' || port === '4173') {
    return `${protocol}//${hostname}:8000`
  }

  // In deployment, prefer same-origin unless explicitly overridden.
  return `${protocol}//${host}`
}

const API_BASE = inferApiBase()

export const config = {
  apiBase: API_BASE,
  wsBase: API_BASE.replace(/^http/, 'ws'),
}
