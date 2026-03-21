const presentationRoutes = ['/home', '/our-mission', '/contact']

function normalizePath(pathname) {
  if (!pathname) {
    return '/'
  }

  const compact = pathname.trim()
  if (compact.length > 1 && compact.endsWith('/')) {
    return compact.slice(0, -1)
  }

  return compact || '/'
}

export function isStartupPresentationPath(pathname) {
  return presentationRoutes.includes(normalizePath(pathname))
}

function Navigation({ pathname }) {
  const normalizedPath = normalizePath(pathname)

  return (
    <header className="startup-header">
      <a className="startup-brand" href="/home">
        VIA Pulse
      </a>
      <nav className="startup-nav" aria-label="Main navigation">
        <a className={normalizedPath === '/home' ? 'active' : ''} href="/home">
          Home
        </a>
        <a className={normalizedPath === '/our-mission' ? 'active' : ''} href="/our-mission">
          Our Mission
        </a>
        <a className={normalizedPath === '/contact' ? 'active' : ''} href="/contact">
          Contact
        </a>
      </nav>
      <a className="startup-cta" href="/">
        Open Product
      </a>
    </header>
  )
}

function HomePage() {
  return (
    <main className="startup-main">
      <section className="startup-hero">
        <p className="startup-kicker">Realtime Classroom Intelligence</p>
        <h1>Build a class where every student is heard, even when they stay silent.</h1>
        <p>
          VIA Pulse transforms live teaching sessions into actionable signals. Confusion alerts,
          break sentiment, and instant quizzes help educators adapt in real time.
        </p>
        <div className="startup-actions">
          <a className="startup-btn startup-btn-primary" href="/contact">
            Book a Demo
          </a>
          <a className="startup-btn startup-btn-secondary" href="/our-mission">
            Learn Our Mission
          </a>
        </div>
      </section>

      <section className="startup-grid" aria-label="Core startup value">
        <article>
          <h2>Signal, not noise</h2>
          <p>
            A single dashboard shows confusion trend, participation pulse, and quiz performance in
            one glance.
          </p>
        </article>
        <article>
          <h2>Designed for live teaching</h2>
          <p>
            The platform overlays engagement tools over presentations without interrupting the class
            flow.
          </p>
        </article>
        <article>
          <h2>From session to evidence</h2>
          <p>
            Export session reports and measure class outcomes over time with lightweight analytics.
          </p>
        </article>
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
          VIA Pulse was born to support educators who need practical tools, not extra complexity.
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
      <section className="startup-panel">
        <p className="startup-kicker">Contact</p>
        <h1>Talk to the team behind VIA Pulse.</h1>
        <p>
          We collaborate with universities, bootcamps, and training teams that want stronger class
          engagement. Reach out and we will respond within one business day.
        </p>
      </section>

      <section className="startup-contact-grid">
        <article>
          <h2>Email</h2>
          <p>
            <a href="mailto:hello@viapulse.app">hello@viapulse.app</a>
          </p>
        </article>
        <article>
          <h2>Phone</h2>
          <p>
            <a href="tel:+4550102000">+45 50 10 20 00</a>
          </p>
        </article>
        <article>
          <h2>Office</h2>
          <p>Dalgas Avenue 2, 8000 Aarhus C, Denmark</p>
        </article>
      </section>
    </main>
  )
}

export function StartupPresentationSite({ pathname }) {
  const normalizedPath = normalizePath(pathname)

  let page = <HomePage />
  if (normalizedPath === '/our-mission') {
    page = <MissionPage />
  } else if (normalizedPath === '/contact') {
    page = <ContactPage />
  }

  return (
    <div className="startup-site-shell">
      <Navigation pathname={normalizedPath} />
      {page}
    </div>
  )
}