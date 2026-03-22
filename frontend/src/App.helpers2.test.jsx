import { apiRequest, postJson } from './App'

/**
 * Tests for parseErrorResponse (internal) exercised through the exported
 * postJson and apiRequest functions, plus additional apiRequest edge-cases.
 */
describe('parseErrorResponse — via postJson', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('extracts the JSON detail field from error responses', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false, status: 422,
      text: async () => JSON.stringify({ detail: 'Field required' }),
    })
    await expect(postJson('/api/x', {})).rejects.toThrow('Field required')
  })

  it('maps HTML 413 to a friendly "file too large" message', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false, status: 413,
      text: async () => '<html><body>Request Entity Too Large</body></html>',
    })
    await expect(postJson('/api/x', {})).rejects.toThrow('File is too large')
  })

  it('maps HTML 414 to a friendly message', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false, status: 414,
      text: async () => '<html>URI Too Long</html>',
    })
    await expect(postJson('/api/x', {})).rejects.toThrow('Request URL too long')
  })

  it('maps HTML 500 to internal server error message', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false, status: 500,
      text: async () => '<html>Internal Server Error</html>',
    })
    await expect(postJson('/api/x', {})).rejects.toThrow('Internal server error')
  })

  it('maps HTML 502 to bad gateway message', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false, status: 502,
      text: async () => '<html>Bad Gateway</html>',
    })
    await expect(postJson('/api/x', {})).rejects.toThrow('Bad gateway')
  })

  it('maps HTML 503 to service unavailable message', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false, status: 503,
      text: async () => '<html>Service Unavailable</html>',
    })
    await expect(postJson('/api/x', {})).rejects.toThrow('Service unavailable')
  })

  it('maps HTML 504 to gateway timeout message', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false, status: 504,
      text: async () => '<html>Gateway Timeout</html>',
    })
    await expect(postJson('/api/x', {})).rejects.toThrow('Gateway timeout')
  })

  it('falls back to generic status message for unmapped HTML status codes', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false, status: 418,
      text: async () => "<html>I'm a teapot</html>",
    })
    await expect(postJson('/api/x', {})).rejects.toThrow('Request failed with status 418')
  })

  it('returns generic message when error body is empty', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false, status: 401,
      text: async () => '',
    })
    await expect(postJson('/api/x', {})).rejects.toThrow('Request failed with status 401')
  })

  it('returns plain text from non-JSON, non-HTML error bodies', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false, status: 400,
      text: async () => 'something went wrong',
    })
    await expect(postJson('/api/x', {})).rejects.toThrow('something went wrong')
  })

  it('returns raw text when JSON body has no detail field', async () => {
    const raw = JSON.stringify({ message: 'no detail key here' })
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false, status: 400,
      text: async () => raw,
    })
    await expect(postJson('/api/x', {})).rejects.toThrow('no detail key here')
  })
})

describe('apiRequest — additional edge cases', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('sends no body for GET requests', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true, status: 200, json: async () => ({}),
    })
    await apiRequest('/api/foo')
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined()
  })

  it('sets Content-Type: application/json for JSON requests', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true, status: 200, json: async () => ({}),
    })
    await apiRequest('/api/foo', { method: 'POST', body: { x: 1 } })
    expect(fetchMock.mock.calls[0][1].headers['Content-Type']).toBe('application/json')
  })

  it('omits Content-Type when isFormData is true', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true, status: 200, json: async () => ({}),
    })
    const fd = new FormData()
    await apiRequest('/api/foo', { method: 'POST', body: fd, token: 'tk', isFormData: true })
    expect(fetchMock.mock.calls[0][1].headers['Content-Type']).toBeUndefined()
  })

  it('attaches Authorization header when token provided', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true, status: 200, json: async () => ({}),
    })
    await apiRequest('/api/foo', { token: 'my-secret-token' })
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer my-secret-token')
  })

  it('omits Authorization header when no token provided', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true, status: 200, json: async () => ({}),
    })
    await apiRequest('/api/foo')
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined()
  })

  it('throws on non-ok responses', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false, status: 404,
      text: async () => 'Not found',
    })
    await expect(apiRequest('/api/missing')).rejects.toThrow('Not found')
  })

  it('returns null for 204 No Content', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true, status: 204,
      text: async () => '',
    })
    const result = await apiRequest('/api/foo', { method: 'DELETE' })
    expect(result).toBeNull()
  })

  it('serialises body to JSON string for non-FormData requests', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true, status: 200, json: async () => ({}),
    })
    await apiRequest('/api/foo', { method: 'POST', body: { name: 'Alice' } })
    expect(fetchMock.mock.calls[0][1].body).toBe('{"name":"Alice"}')
  })
})
