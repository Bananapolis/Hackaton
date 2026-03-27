import { useEffect, useState } from 'react'
import { config } from './config'
import { navigate } from './navigate'

const authTokenStorageKey = 'auth-token-v1'
const authUserStorageKey = 'auth-user-v1'

function getAuth() {
  try {
    const token = localStorage.getItem(authTokenStorageKey) || ''
    const raw = localStorage.getItem(authUserStorageKey)
    const user = raw ? JSON.parse(raw) : null
    return { token, user }
  } catch {
    return { token: '', user: null }
  }
}

function clearAuth() {
  try {
    localStorage.removeItem(authTokenStorageKey)
    localStorage.removeItem(authUserStorageKey)
  } catch {}
}

async function apiRequest(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetch(`${config.apiBase}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) {
    const text = await response.text()
    let msg = `Request failed (${response.status})`
    try { msg = JSON.parse(text).detail || text } catch {}
    throw new Error(msg)
  }
  if (response.status === 204) return null
  return response.json()
}

function getTheme() {
  try { return localStorage.getItem('ui-theme') === 'dark' ? 'dark' : 'light' } catch { return 'light' }
}

function setThemePersist(t) {
  try {
    localStorage.setItem('ui-theme', t)
    document.documentElement.classList.toggle('dark', t === 'dark')
    // Dispatch custom event to sync with App.jsx if needed
    window.dispatchEvent(new CustomEvent('theme-change', { detail: { theme: t } }))
  } catch {}
}

function formatDate(iso) {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
  } catch { return iso }
}

export function DashboardPage() {
  const { token, user } = getAuth()

  const [theme, setThemeState] = useState(() => getTheme())
  const [joinCode, setJoinCode] = useState('')
  const [sessions, setSessions] = useState([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [sessionsError, setSessionsError] = useState('')
  const [createPending, setCreatePending] = useState(false)
  const [createError, setCreateError] = useState('')
  const [selectedSession, setSelectedSession] = useState(null)

  // Redirect if no auth
  useEffect(() => {
    if (!token || !user) {
      navigate('/login?return=/dashboard')
    }
  }, [token, user])

  // Apply theme
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  // Load sessions
  useEffect(() => {
    if (!token) return
    setSessionsLoading(true)
    apiRequest('/api/library/sessions', { token })
      .then((data) => {
        setSessions(Array.isArray(data?.sessions) ? data.sessions : [])
        setSessionsLoading(false)
      })
      .catch((err) => {
        setSessionsError(err.message)
        setSessionsLoading(false)
      })
  }, [token])

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setThemeState(next)
    setThemePersist(next)
  }

  function signOut() {
    clearAuth()
    navigate('/')
  }

  async function createSession() {
    if (!token || !user) return
    setCreateError('')
    setCreatePending(true)
    try {
      const data = await apiRequest('/api/sessions', {
        method: 'POST',
        token,
        body: { teacher_name: user.display_name || user.email || 'Teacher' },
      })
      if (data?.code) {
        navigate(`/session?code=${encodeURIComponent(data.code)}&role=teacher`)
      }
    } catch (err) {
      setCreateError(err.message)
      setCreatePending(false)
    }
  }

  function joinSession(event) {
    event.preventDefault()
    const code = joinCode.trim().toUpperCase()
    if (!code) return
    navigate(`/session?code=${encodeURIComponent(code)}`)
  }

  function downloadReport(code) {
    window.open(`${config.apiBase}/api/sessions/${encodeURIComponent(code)}/report.pdf`, '_blank')
  }

  function openSession(session) {
    if (session.is_live) {
      navigate(`/session?code=${encodeURIComponent(session.code)}&role=student`)
    } else {
      setSelectedSession(session)
    }
  }

  const displayName = user?.display_name || user?.email || 'there'
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  if (!token || !user) return null

  return (
    <div className="startup-site-shell startup-dashboard-shell">
      {/* Header */}
      <header className="startup-header">
        <a className="startup-brand" href="/">
          <span>Live</span>
          <span style={{ color: 'var(--startup-accent)' }}>Pulse</span>
        </a>
        <div className="startup-dashboard-header-right">
          <span className="startup-dashboard-username">{displayName}</span>
          <button
            type="button"
            onClick={toggleTheme}
            className="startup-dashboard-icon-btn"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
              </svg>
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm('Are you sure you want to sign out?')) {
                signOut()
              }
            }}
            className="startup-dashboard-signout-btn"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="startup-main startup-dashboard-main">

        {/* Hero: greeting + CTAs */}
        <section className="startup-dashboard-hero">
          <div>
            <p className="startup-kicker">{greeting}</p>
            <h1 className="startup-dashboard-heading">{displayName}</h1>
            <p style={{ color: 'var(--startup-muted)', marginTop: '0.5rem' }}>
              What would you like to do today?
            </p>
          </div>

          <div className="startup-dashboard-actions">
            {/* Start session */}
            <div className="startup-dashboard-action-card startup-dashboard-action-primary">
              <div className="startup-dashboard-action-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                </svg>
              </div>
              <h2>Start a new session</h2>
              <p>Launch a live classroom with screen sharing, quizzes, and real-time engagement signals.</p>
              {createError && <div className="startup-dashboard-error">{createError}</div>}
              <button
                type="button"
                onClick={createSession}
                disabled={createPending}
                className="startup-btn startup-btn-primary"
                style={{ marginTop: 'auto', width: '100%', textAlign: 'center' }}
              >
                {createPending ? 'Creating…' : 'Start session'}
              </button>
            </div>

            {/* Join session */}
            <div className="startup-dashboard-action-card">
              <div className="startup-dashboard-action-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>
                </svg>
              </div>
              <h2>Join a session</h2>
              <p>Enter the six-character code shared by your teacher to join as a student.</p>
              <form onSubmit={joinSession} className="startup-dashboard-join-form">
                <input
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  className="startup-dashboard-code-input"
                  placeholder="Session code"
                  maxLength={6}
                  autoCapitalize="characters"
                  spellCheck={false}
                />
                <button
                  type="submit"
                  disabled={!joinCode.trim()}
                  className="startup-btn startup-btn-primary"
                >
                  Join
                </button>
              </form>
            </div>
          </div>
        </section>

        {/* Recent sessions */}
        <section className="startup-dashboard-sessions">
          <div className="startup-dashboard-section-header">
            <h2 className="startup-dashboard-section-title">Recent sessions</h2>
          </div>

          {sessionsLoading ? (
            <div className="startup-dashboard-empty">Loading sessions…</div>
          ) : sessionsError ? (
            <div className="startup-dashboard-empty" style={{ color: 'var(--startup-accent-alt)' }}>
              Could not load sessions: {sessionsError}
            </div>
          ) : sessions.length === 0 ? (
            <div className="startup-dashboard-empty">
              No sessions yet. Start your first one above.
            </div>
          ) : (
            <div className="startup-dashboard-sessions-grid">
              {sessions.map((session) => (
                <article key={session.code} className="startup-dashboard-session-card">
                  <div className="startup-dashboard-session-code">{session.code}</div>
                  <div className="startup-dashboard-session-meta">
                    <span>{formatDate(session.created_at)}</span>
                    {session.teacher_name && <span>{session.teacher_name}</span>}
                    {session.student_count != null && (
                      <span>{session.student_count} student{session.student_count !== 1 ? 's' : ''}</span>
                    )}
                  </div>
                  <div className="startup-dashboard-session-footer">
                    {session.is_live && <span className="startup-dashboard-session-live">Live</span>}
                    <button
                      type="button"
                      onClick={() => openSession(session)}
                      className="startup-dashboard-session-btn startup-dashboard-session-btn-primary"
                      style={{ marginLeft: 'auto' }}
                    >
                      {session.is_live ? 'Join →' : 'Details →'}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

      </main>

      {selectedSession && (
        <div className="session-modal-overlay" onClick={() => setSelectedSession(null)} role="dialog" aria-modal="true">
          <div className="session-modal" onClick={(e) => e.stopPropagation()}>
            <div className="session-modal-header">
              <span className="session-modal-code">{selectedSession.code}</span>
              <button
                type="button"
                className="session-modal-close"
                onClick={() => setSelectedSession(null)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="session-modal-meta">
              <div><span className="session-modal-label">Date</span>{formatDate(selectedSession.created_at)}</div>
              <div><span className="session-modal-label">Host</span>{selectedSession.teacher_name || '—'}</div>
              {selectedSession.student_count != null && (
                <div><span className="session-modal-label">Students</span>{selectedSession.student_count}</div>
              )}
              <div>
                <span className="session-modal-label">Status</span>
                {selectedSession.active ? 'Ended (no active connection)' : 'Ended'}
              </div>
            </div>
            <div className="session-modal-actions">
              <button
                type="button"
                className="startup-btn startup-btn-primary"
                onClick={() => { downloadReport(selectedSession.code); setSelectedSession(null) }}
              >
                Download engagement report
              </button>
              <button
                type="button"
                className="startup-dashboard-session-btn"
                onClick={() => setSelectedSession(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="startup-footer">
        <p>© {new Date().getFullYear()} Live Pulse</p>
        <p>
          <a href="/our-mission">Our Mission</a>
          {' · '}
          <a href="/contact">Contact</a>
        </p>
      </footer>
    </div>
  )
}
