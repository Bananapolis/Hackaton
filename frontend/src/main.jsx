import React from 'react'
import ReactDOM from 'react-dom/client'
import { GoogleOAuthProvider } from '@react-oauth/google'
import App from './App'
import { StartupPresentationSite, isStartupPresentationPath } from './StartupPresentationSite'
import { LoginPage } from './LoginPage'
import { DashboardPage } from './DashboardPage'
import './styles.css'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

function normalizePath(pathname) {
  if (!pathname) return '/'
  const compact = pathname.trim()
  if (compact.length > 1 && compact.endsWith('/')) return compact.slice(0, -1)
  return compact || '/'
}

function hasAuthToken() {
  try { return Boolean(localStorage.getItem('auth-token-v1')) } catch { return false }
}

class GlobalErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('Uncaught error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '2rem', textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Something went wrong</h1>
          <pre
            style={{
              textAlign: 'left',
              padding: '1rem',
              background: '#f1f5f9',
              borderRadius: '0.5rem',
              overflow: 'auto',
              color: '#dc2626',
              fontSize: '0.875rem',
            }}
          >
            {this.state.error?.toString()}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: '1rem',
              padding: '0.5rem 1rem',
              background: '#0f172a',
              color: 'white',
              borderRadius: '0.25rem',
              cursor: 'pointer',
            }}
          >
            Reload Page
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function RootApp() {
  const [pathname, setPathname] = React.useState(() => window.location.pathname)

  React.useEffect(() => {
    const syncPathname = () => setPathname(window.location.pathname)
    window.addEventListener('popstate', syncPathname)
    return () => window.removeEventListener('popstate', syncPathname)
  }, [])

  // Handle OAuth redirect params on any page (GitHub sends ?oauth_token=... back)
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const oauthToken = params.get('oauth_token')
    const oauthUserRaw = params.get('oauth_user')
    const oauthError = params.get('oauth_error')

    if (oauthError) {
      // Clean up URL and go to login with error preserved in state
      window.history.replaceState({}, '', '/login')
      setPathname('/login')
      return
    }

    if (oauthToken && oauthUserRaw) {
      try {
        localStorage.setItem('auth-token-v1', oauthToken)
        localStorage.setItem('auth-user-v1', oauthUserRaw)
      } catch {}
      window.history.replaceState({}, '', '/dashboard')
      setPathname('/dashboard')
    }
  }, [])

  // Backward compat: /?code=XXX (old share link format) → /session?code=XXX
  React.useEffect(() => {
    const norm = normalizePath(pathname)
    if (norm === '/') {
      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')
      if (code) {
        const dest = `/session?code=${encodeURIComponent(code)}`
        window.history.replaceState({}, '', dest)
        setPathname('/session')
      }
    }
  }, [pathname])

  const norm = normalizePath(pathname)

  // Public marketing pages
  if (isStartupPresentationPath(norm)) {
    return <StartupPresentationSite pathname={norm} />
  }

  // Login / register
  if (norm === '/login') {
    return <LoginPage />
  }

  // Legacy: /home → redirect to /
  if (norm === '/home') {
    window.history.replaceState({}, '', '/')
    return <StartupPresentationSite pathname="/" />
  }

  // Protected: dashboard
  if (norm === '/dashboard') {
    if (!hasAuthToken()) {
      window.history.replaceState({}, '', '/login')
      return <LoginPage />
    }
    return <DashboardPage />
  }

  // Protected: live session
  if (norm === '/session') {
    if (!hasAuthToken()) {
      const returnUrl = '/session' + window.location.search
      window.history.replaceState({}, '', `/login?return=${encodeURIComponent(returnUrl)}`)
      return <LoginPage />
    }
    return <App />
  }

  // Fallback: show landing page
  return <StartupPresentationSite pathname="/" />
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <GlobalErrorBoundary>
      {GOOGLE_CLIENT_ID
        ? <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}><RootApp /></GoogleOAuthProvider>
        : <RootApp />}
    </GlobalErrorBoundary>
  </React.StrictMode>,
)
