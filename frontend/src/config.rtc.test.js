/**
 * Tests for the RTC ice-server parsing and wsBase inference logic in config.js.
 * Each test resets modules so the top-level env-var capture re-runs fresh.
 */
describe('config — RTC ice servers', () => {
  afterEach(() => {
    vi.resetModules()
    import.meta.env.VITE_RTC_ICE_SERVERS = ''
    import.meta.env.VITE_API_BASE = ''
  })

  it('uses built-in STUN fallbacks when VITE_RTC_ICE_SERVERS is unset', async () => {
    const { config } = await import('./config')
    expect(config.rtcConfig.iceServers.length).toBeGreaterThan(0)
    expect(config.rtcConfig.iceServers.every((s) => s.urls)).toBe(true)
  })

  it('parses a single valid server with a string URL', async () => {
    vi.resetModules()
    import.meta.env.VITE_RTC_ICE_SERVERS = JSON.stringify([{ urls: 'stun:example.com:3478' }])
    const { config } = await import('./config')
    expect(config.rtcConfig.iceServers).toEqual([{ urls: 'stun:example.com:3478' }])
  })

  it('parses a server with an array of URLs', async () => {
    vi.resetModules()
    import.meta.env.VITE_RTC_ICE_SERVERS = JSON.stringify([
      { urls: ['stun:a.com:3478', 'stun:b.com:3478'] },
    ])
    const { config } = await import('./config')
    const server = config.rtcConfig.iceServers[0]
    expect(Array.isArray(server.urls)).toBe(true)
    expect(server.urls).toHaveLength(2)
  })

  it('preserves username and credential fields', async () => {
    vi.resetModules()
    import.meta.env.VITE_RTC_ICE_SERVERS = JSON.stringify([
      { urls: 'turn:relay.example.com:3478', username: 'user1', credential: 'secret' },
    ])
    const { config } = await import('./config')
    const server = config.rtcConfig.iceServers[0]
    expect(server.username).toBe('user1')
    expect(server.credential).toBe('secret')
  })

  it('trims whitespace from string URLs', async () => {
    vi.resetModules()
    import.meta.env.VITE_RTC_ICE_SERVERS = JSON.stringify([{ urls: '  stun:example.com:3478  ' }])
    const { config } = await import('./config')
    expect(config.rtcConfig.iceServers[0].urls).toBe('stun:example.com:3478')
  })

  it('filters out entries with no valid urls field', async () => {
    vi.resetModules()
    import.meta.env.VITE_RTC_ICE_SERVERS = JSON.stringify([
      { urls: 'stun:good.com:3478' },
      { notUrls: 'ignored' },
      null,
      42,
    ])
    const { config } = await import('./config')
    expect(config.rtcConfig.iceServers).toHaveLength(1)
    expect(config.rtcConfig.iceServers[0].urls).toBe('stun:good.com:3478')
  })

  it('filters array entries that are all empty strings', async () => {
    vi.resetModules()
    import.meta.env.VITE_RTC_ICE_SERVERS = JSON.stringify([
      { urls: ['', '   '] },
      { urls: 'stun:ok.com:3478' },
    ])
    const { config } = await import('./config')
    expect(config.rtcConfig.iceServers).toHaveLength(1)
    expect(config.rtcConfig.iceServers[0].urls).toBe('stun:ok.com:3478')
  })

  it('falls back to defaults when all entries are invalid', async () => {
    vi.resetModules()
    import.meta.env.VITE_RTC_ICE_SERVERS = JSON.stringify([null, { notUrls: 'x' }, 42])
    const { config } = await import('./config')
    expect(
      config.rtcConfig.iceServers.some((s) => String(s.urls).includes('google.com')),
    ).toBe(true)
  })

  it('falls back to defaults on invalid JSON', async () => {
    vi.resetModules()
    import.meta.env.VITE_RTC_ICE_SERVERS = '{not valid json'
    const { config } = await import('./config')
    expect(
      config.rtcConfig.iceServers.some((s) => String(s.urls).includes('google.com')),
    ).toBe(true)
  })

  it('falls back to defaults when JSON is not an array', async () => {
    vi.resetModules()
    import.meta.env.VITE_RTC_ICE_SERVERS = JSON.stringify({ urls: 'stun:example.com' })
    const { config } = await import('./config')
    expect(
      config.rtcConfig.iceServers.some((s) => String(s.urls).includes('google.com')),
    ).toBe(true)
  })

  it('does not include username/credential when they are empty strings', async () => {
    vi.resetModules()
    import.meta.env.VITE_RTC_ICE_SERVERS = JSON.stringify([
      { urls: 'stun:example.com:3478', username: '  ', credential: '' },
    ])
    const { config } = await import('./config')
    const server = config.rtcConfig.iceServers[0]
    expect(server.username).toBeUndefined()
    expect(server.credential).toBeUndefined()
  })
})

describe('config — wsBase inference', () => {
  afterEach(() => {
    vi.resetModules()
    import.meta.env.VITE_API_BASE = ''
  })

  it('converts https API base to wss WebSocket base', async () => {
    vi.resetModules()
    import.meta.env.VITE_API_BASE = 'https://api.example.com'
    const { config } = await import('./config')
    expect(config.wsBase).toBe('wss://api.example.com')
  })

  it('converts http API base to ws WebSocket base', async () => {
    vi.resetModules()
    import.meta.env.VITE_API_BASE = 'http://localhost:9000'
    const { config } = await import('./config')
    expect(config.wsBase).toBe('ws://localhost:9000')
  })

  it('wsBase is a string when API base is empty (same-origin mode)', async () => {
    vi.resetModules()
    import.meta.env.VITE_API_BASE = ''
    const { config } = await import('./config')
    expect(typeof config.wsBase).toBe('string')
  })
})
