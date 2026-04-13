import { render, screen, within } from '@testing-library/react'
import { isStartupPresentationPath, StartupPresentationSite } from './StartupPresentationSite'

describe('isStartupPresentationPath', () => {
  it.each(['/', '/our-mission', '/contact'])('returns true for %s', (path) => {
    expect(isStartupPresentationPath(path)).toBe(true)
  })

  it.each(['/home', '/app', '/dashboard', '/other'])('returns false for %s', (path) => {
    expect(isStartupPresentationPath(path)).toBe(false)
  })

  it('strips trailing slash before matching', () => {
    expect(isStartupPresentationPath('/contact/')).toBe(true)
    expect(isStartupPresentationPath('/our-mission/')).toBe(true)
  })

  it('returns false for empty string', () => {
    expect(isStartupPresentationPath('')).toBe(false)
  })

  it('returns false for null', () => {
    expect(isStartupPresentationPath(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isStartupPresentationPath(undefined)).toBe(false)
  })
})

describe('StartupPresentationSite rendering', () => {
  it('renders home page for /', () => {
    render(<StartupPresentationSite pathname="/" />)
    expect(screen.getByText(/realtime classroom intelligence/i)).toBeInTheDocument()
    expect(screen.getByText(/build a class where every student is heard/i)).toBeInTheDocument()
  })

  it('renders the home value grid', () => {
    render(<StartupPresentationSite pathname="/" />)
    expect(screen.getByText(/signal, not noise/i)).toBeInTheDocument()
    expect(screen.getByText(/designed for live teaching/i)).toBeInTheDocument()
    expect(screen.getByText(/from session to evidence/i)).toBeInTheDocument()
  })

  it('renders CTA buttons on home page', () => {
    render(<StartupPresentationSite pathname="/" />)
    expect(screen.getByRole('link', { name: /get started/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /learn more/i })).toBeInTheDocument()
  })

  it('renders mission page for /our-mission', () => {
    render(<StartupPresentationSite pathname="/our-mission" />)
    expect(screen.getByText(/make learning loops visible/i)).toBeInTheDocument()
    expect(screen.getByText(/transparency/i)).toBeInTheDocument()
    expect(screen.getByText(/accessibility/i)).toBeInTheDocument()
    expect(screen.getByText(/evidence-led improvement/i)).toBeInTheDocument()
  })

  it('renders contact page for /contact', () => {
    render(<StartupPresentationSite pathname="/contact" />)
    expect(screen.getByText(/talk to the team behind Live Pulse/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /bananapolis/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /93920729/i })).toBeInTheDocument()
  })

  it('defaults to home page for unrecognised paths', () => {
    render(<StartupPresentationSite pathname="/does-not-exist" />)
    expect(screen.getByText(/realtime classroom intelligence/i)).toBeInTheDocument()
  })

  it('normalises trailing slashes when routing pages', () => {
    render(<StartupPresentationSite pathname="/our-mission/" />)
    expect(screen.getByText(/make learning loops visible/i)).toBeInTheDocument()
  })
})

describe('StartupPresentationSite navigation', () => {
  it('always renders brand name and auth CTA link', () => {
    const { container } = render(<StartupPresentationSite pathname="/" />)
    const header = container.querySelector('.startup-header')
    expect(within(header).getByRole('link', { name: /Live/i })).toBeInTheDocument()
    // CTA is either "Sign In" or "Dashboard" depending on localStorage
    expect(within(header).getByRole('link', { name: /sign in|dashboard/i })).toBeInTheDocument()
  })

  it('renders all three nav links', () => {
    const { container } = render(<StartupPresentationSite pathname="/" />)
    const nav = container.querySelector('.startup-nav')
    expect(within(nav).getByRole('link', { name: /^home$/i })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: /^our mission$/i })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: /^contact$/i })).toBeInTheDocument()
  })

  it('marks / as the active nav link', () => {
    const { container } = render(<StartupPresentationSite pathname="/" />)
    const activeLinks = container.querySelectorAll('.startup-nav a.active')
    expect(activeLinks).toHaveLength(1)
    expect(activeLinks[0].textContent).toMatch(/home/i)
  })

  it('marks /our-mission as the active nav link', () => {
    const { container } = render(<StartupPresentationSite pathname="/our-mission" />)
    const activeLinks = container.querySelectorAll('.startup-nav a.active')
    expect(activeLinks).toHaveLength(1)
    expect(activeLinks[0].textContent).toMatch(/our mission/i)
  })

  it('marks /contact as the active nav link', () => {
    const { container } = render(<StartupPresentationSite pathname="/contact" />)
    const activeLinks = container.querySelectorAll('.startup-nav a.active')
    expect(activeLinks).toHaveLength(1)
    expect(activeLinks[0].textContent).toMatch(/contact/i)
  })

  it('no nav link is active for unrecognised paths', () => {
    const { container } = render(<StartupPresentationSite pathname="/other" />)
    const activeLinks = container.querySelectorAll('.startup-nav a.active')
    expect(activeLinks).toHaveLength(0)
  })
})
