import { render } from '@testing-library/react'
import { Icon, apiRequest, loadSessionPreferences, postJson } from './App'

describe('App helper functions', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('loads role and name from localStorage without restoring session code', () => {
    window.localStorage.setItem(
      'session-preferences-v1',
      JSON.stringify({ role: 'teacher', name: 'Ana', sessionCode: 'abc123' }),
    )

    const prefs = loadSessionPreferences()
    expect(prefs).toEqual({ role: 'teacher', name: 'Ana', sessionCode: '' })
  })

  it('falls back to defaults on malformed preferences', () => {
    window.localStorage.setItem('session-preferences-v1', '{bad-json')

    const prefs = loadSessionPreferences()
    expect(prefs).toEqual({ role: 'student', name: '', sessionCode: '' })
  })

  it('postJson sends JSON body and returns parsed result', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ code: 'ABC123' }),
    })

    const result = await postJson('/api/sessions', { teacher_name: 'T' })

    expect(result).toEqual({ code: 'ABC123' })
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/sessions'),
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })

  it('postJson throws on non-ok responses', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'bad request',
    })

    await expect(postJson('/api/sessions', { teacher_name: '' })).rejects.toThrow('bad request')
  })

  it('apiRequest supports auth, form data and 204 responses', async () => {
    const fetchMock = vi.spyOn(global, 'fetch')

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 204,
      text: async () => '',
    })

    const formData = new FormData()
    formData.append('session_code', 'ABC123')
    await expect(
      apiRequest('/api/presentations', {
        method: 'POST',
        body: formData,
        token: 'token',
        isFormData: true,
      }),
    ).resolves.toBeNull()

    const call = fetchMock.mock.calls[0]
    expect(call[1].headers.Authorization).toBe('Bearer token')
    expect(call[1].headers['Content-Type']).toBeUndefined()
  })

  it('renders known icon and ignores unknown one', () => {
    const known = render(<Icon name="copy" />)
    expect(known.container.querySelector('svg')).not.toBeNull()

    const unknown = render(<Icon name="does-not-exist" />)
    expect(unknown.container).toBeEmptyDOMElement()
  })
})
