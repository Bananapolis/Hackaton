import { useState, useEffect } from 'react'

const presentationRoutes = ['/', '/our-mission', '/contact']

function getTheme() {
  try { return localStorage.getItem('ui-theme') === 'dark' ? 'dark' : 'light' } catch { return 'light' }
}

function normalizePath(pathname) {
  if (!pathname) return '/'
  const compact = pathname.trim()
  if (compact.length > 1 && compact.endsWith('/')) return compact.slice(0, -1)
  return compact || '/'
}

export function isStartupPresentationPath(pathname) {
  if (!pathname) return false
  return presentationRoutes.includes(normalizePath(pathname))
}

function getAuthCta() {
  try {
    return localStorage.getItem('auth-token-v1') ? 'Dashboard' : 'Sign In'
  } catch {
    return 'Sign In'
  }
}

function getAuthCtaHref() {
  try {
    return localStorage.getItem('auth-token-v1') ? '/dashboard' : '/login'
  } catch {
    return '/login'
  }
}

function Navigation({ pathname }) {
  const normalizedPath = normalizePath(pathname)
  const ctaLabel = getAuthCta()
  const ctaHref = getAuthCtaHref()

  return (
    <header className="startup-header">
      <a className="startup-brand" href="/">
        <span>Live</span>
        <span style={{ color: 'var(--startup-accent)' }}>Pulse</span>
      </a>
      <nav className="startup-nav" aria-label="Main navigation">
        <a className={normalizedPath === '/' ? 'active' : ''} href="/">Home</a>
        <a className={normalizedPath === '/our-mission' ? 'active' : ''} href="/our-mission">Our Mission</a>
        <a className={normalizedPath === '/contact' ? 'active' : ''} href="/contact">Contact</a>
      </nav>
      <a className="startup-cta" href={ctaHref}>{ctaLabel}</a>
    </header>
  )
}

function QuickJoinForm() {
  function handleSubmit(event) {
    event.preventDefault()
    const form = event.currentTarget
    const code = form.elements.code.value.trim().toUpperCase()
    if (!code) return
    window.location.href = `/session?code=${encodeURIComponent(code)}`
  }

  return (
    <form onSubmit={handleSubmit} className="startup-quickjoin-form">
      <input
        name="code"
        className="startup-quickjoin-input"
        placeholder="Enter session code"
        maxLength={6}
        autoCapitalize="characters"
        spellCheck={false}
      />
      <button type="submit" className="startup-btn startup-btn-primary">
        Join
      </button>
    </form>
  )
}

function HomePage() {
  return (
    <main className="startup-main">
      {/* Hero */}
      <div className="startup-hero-grid">
        <section className="startup-hero">
          <p className="startup-kicker">Realtime Classroom Intelligence</p>
          <h1>Build a class where every student is heard, even when they stay silent.</h1>
          <p className="lead">
            Live Pulse transforms live teaching sessions into actionable signals. Confusion alerts,
            break sentiment, and instant AI quizzes help educators adapt in real time.
          </p>
          <div className="startup-actions">
            <a className="startup-btn startup-btn-primary" href="/login">
              Get Started Free
            </a>
            <a className="startup-btn startup-btn-secondary" href="/our-mission">
              Learn More
            </a>
          </div>
          <div className="startup-ribbon">
            <p>No installs for students</p>
            <p>AI-generated quizzes</p>
            <p>Real-time signals</p>
            <p>Session PDF reports</p>
          </div>
        </section>

        {/* Story card */}
        <aside className="startup-story-card">
          <h2>Empower every student</h2>
          <ul>
            <li>
              <strong>Active Participation</strong>
              <span>Give every student a voice in real-time</span>
            </li>
            <li>
              <strong>Instant Feedback</strong>
              <span>Never lose track of student engagement</span>
            </li>
            <li>
              <strong>AI Intelligence</strong>
              <span>Generate quizzes instantly to test understanding</span>
            </li>
          </ul>
        </aside>
      </div>

      {/* Feature grid */}
      <section className="startup-grid" aria-label="Core features" style={{ marginTop: '3rem' }}>
        <article>
          <h2>Signal, not noise</h2>
          <p>
            One dashboard: confusion trend, participation pulse, and quiz performance — all visible
            to the teacher in a single glance without interrupting the lecture.
          </p>
        </article>
        <article>
          <h2>Designed for live teaching</h2>
          <p>
            Screen sharing overlays engagement tools directly over your presentations. No app
            installs needed — students join via link or QR code in any browser.
          </p>
        </article>
        <article>
          <h2>From session to evidence</h2>
          <p>
            Export session reports as PDFs and review quiz accuracy, confusion peaks, and
            participation data to improve future classes.
          </p>
        </article>
      </section>

      {/* How it works */}
      <section style={{ marginTop: '3.5rem' }}>
        <p className="startup-kicker">How it works</p>
        <h2 style={{ margin: '0.7rem 0 0', fontSize: 'clamp(1.5rem, 2.5vw, 2rem)', color: 'var(--startup-ink)' }}>
          Three steps to an engaged classroom
        </h2>
        <div className="startup-process">
          <article>
            <div className="startup-step">01</div>
            <h3>Teacher starts a session</h3>
            <p>
              Sign in, create a session, and share the code or QR on screen. Students join instantly
              — no accounts needed.
            </p>
          </article>
          <article>
            <div className="startup-step">02</div>
            <h3>Students signal in real time</h3>
            <p>
              Anonymously mark confusion, vote for breaks, answer AI-generated quizzes, and ask
              questions from any device.
            </p>
          </article>
          <article>
            <div className="startup-step">03</div>
            <h3>Teacher adapts instantly</h3>
            <p>
              Live metrics and alerts surface when the class needs a pause or extra explanation.
              All data is saved for post-session review.
            </p>
          </article>
        </div>
      </section>

      {/* Quote */}
      <section style={{ marginTop: '3rem' }}>
        <div className="startup-quote">
          <blockquote>
            "The feedback loop that used to happen only after class now happens during it — that
            changes everything."
          </blockquote>
          <p>Early adopter faculty</p>
        </div>
      </section>

      {/* Quick join for students */}
      <section style={{ marginTop: '3.5rem' }}>
        <div className="startup-panel" style={{ maxWidth: '560px' }}>
          <p className="startup-kicker">Students</p>
          <h2 style={{ margin: '0.6rem 0 0.5rem', fontSize: '1.45rem', color: 'var(--startup-ink)' }}>
            Got a session code?
          </h2>
          <p style={{ marginBottom: '1.1rem' }}>
            Enter the six-character code from your teacher to join the live session in your browser.
          </p>
          <QuickJoinForm />
        </div>
      </section>
    </main>
  )
}

function MissionPage() {
  return (
    <main className="startup-main startup-main-compact">
      <section className="startup-panel">
        <p className="startup-kicker">Our Mission</p>
        <h1>Make learning loops visible, fast, and human.</h1>
        <p>
          We believe great teaching depends on fast feedback. Our mission is to remove the blind
          spots in classrooms by making student engagement measurable in real time.
        </p>
        <p>
          Live Pulse was born to support educators who need practical tools, not extra complexity.
          Every feature is built to reduce friction while increasing student confidence and
          participation.
        </p>
      </section>
      <section className="startup-grid startup-grid-mission">
        <article>
          <h2>Transparency</h2>
          <p>Students can express confusion anonymously, and teachers can react without delay.</p>
        </article>
        <article>
          <h2>Accessibility</h2>
          <p>Our experience works directly in the browser with no installs for students.</p>
        </article>
        <article>
          <h2>Evidence-led improvement</h2>
          <p>Session metrics become concrete data for continuous course refinement.</p>
        </article>
      </section>
    </main>
  )
}

function ContactPage() {
  return (
    <main className="startup-main startup-main-compact">
      <section className="startup-panel startup-panel-contact">
        <p className="startup-kicker">Contact</p>
        <h1>Talk to the team behind Live Pulse.</h1>
        <p>
          We collaborate with universities, bootcamps, and training teams that want stronger class
          engagement. Reach out and we will respond within one business day.
        </p>
      </section>

      <section className="startup-contact-grid">
        <article>
          <h2>Email</h2>
          <p>
            <a href="mailto:Bananapolis@eduardfekete.com">Bananapolis@eduardfekete.com</a>
          </p>
        </article>
        <article>
          <h2>Phone</h2>
          <p>
            <a href="tel:+4593920729">+45 93920729</a>
          </p>
        </article>
      </section>

      <div className="startup-contact-cta">
        <h2>Book a demo</h2>
        <p>
          Prefer a guided walkthrough? Send us an email and we will schedule a 20-minute demo
          tailored to your institution.
        </p>
        <a href="mailto:Bananapolis@eduardfekete.com?subject=Demo Request" className="startup-btn startup-btn-primary">
          Request a demo
        </a>
      </div>
    </main>
  )
}

function Footer() {
  return (
    <footer className="startup-footer">
      <p>
        <a href="/our-mission">Our Mission</a>
        {' · '}
        <a href="/contact">Contact</a>
        {' · '}
        <a href="/login">Sign In</a>
      </p>
    </footer>
  )
}

export function StartupPresentationSite({ pathname }) {
  const [theme] = useState(() => getTheme())
  const normalizedPath = normalizePath(pathname)

  // Apply theme
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  let page = <HomePage />
  if (normalizedPath === '/our-mission') page = <MissionPage />
  else if (normalizedPath === '/contact') page = <ContactPage />

  return (
    <div className="startup-site-shell">
      <Navigation pathname={normalizedPath} />
      {page}
      <Footer />
    </div>
  )
}
