describe('config', () => {
  it('exposes apiBase and wsBase strings', async () => {
    const mod = await import('./config')

    expect(typeof mod.config.apiBase).toBe('string')
    expect(typeof mod.config.wsBase).toBe('string')
  })

  it('uses explicit API base when VITE_API_BASE is provided', async () => {
    const original = import.meta.env.VITE_API_BASE
    import.meta.env.VITE_API_BASE = 'https://api.example.com'
    vi.resetModules()

    const mod = await import('./config')
    expect(mod.config.apiBase).toBe('https://api.example.com')
    expect(mod.config.wsBase).toBe('wss://api.example.com')

    import.meta.env.VITE_API_BASE = original
    vi.resetModules()
  })
})
