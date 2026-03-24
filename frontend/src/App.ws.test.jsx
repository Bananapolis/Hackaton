/**
 * WebSocket simulation tests.
 *
 * Strategy: we replace global.WebSocket with a controllable mock so we can
 * drive the full session flow — create session → WS open → receive server
 * messages — without any real server. This exercises the large onmessage
 * handler in App.jsx that is otherwise invisible to plain integration tests.
 */
import { render, screen, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

// ─── Controllable WebSocket mock ──────────────────────────────────────────────

let capturedWs = null

class MockWebSocket {
  constructor(url) {
    capturedWs = this
    this.url = url
    this.readyState = 0 // CONNECTING
    this._sent = []
    this.onopen = null
    this.onmessage = null
    this.onclose = null
    this.onerror = null
  }
  send(data) { this._sent.push(JSON.parse(data)) }
  close() { this.readyState = 3; this.onclose?.({ code: 1000 }) }
  triggerOpen() { this.readyState = 1; this.onopen?.() }
  triggerMessage(payload) { this.onmessage?.({ data: JSON.stringify(payload) }) }
  triggerError() { this.onerror?.({}) }
}
MockWebSocket.OPEN = 1
MockWebSocket.CONNECTING = 0
MockWebSocket.CLOSED = 3

// ─── Auth / localStorage helpers ─────────────────────────────────────────────

function setTeacherAuth() {
  window.localStorage.setItem('auth-token-v1', 'tok')
  window.localStorage.setItem(
    'auth-user-v1',
    JSON.stringify({ id: 1, display_name: 'Prof. Smith', role: 'teacher' }),
  )
  // session-preferences-v1 drives the teacher/student UI mode
  window.localStorage.setItem(
    'session-preferences-v1',
    JSON.stringify({ role: 'teacher', name: 'Prof. Smith' }),
  )
}

function setStudentAuth() {
  window.localStorage.setItem('auth-token-v1', 'tok')
  window.localStorage.setItem(
    'auth-user-v1',
    JSON.stringify({ id: 2, display_name: 'Alice', role: 'student' }),
  )
  window.localStorage.setItem(
    'session-preferences-v1',
    JSON.stringify({ role: 'student', name: 'Alice' }),
  )
}

const welcomePayload = {
  client_id: 'cid-abc',
  notes: 'Lecture notes go here',
  quiz: null,
  metrics: { confusion_count: 0, confusion_level_percent: 0, break_votes: 0, student_count: 3 },
  quiz_state: {
    hidden: false, cover_mode: true, voting_closed: false,
    answer_revealed: false, correct_option_id: null, per_option: null,
  },
  break_active_until: null,
}

// ─── Session join helpers ─────────────────────────────────────────────────────

async function mountAndJoinAsTeacher() {
  setTeacherAuth()
  global.fetch = vi.fn().mockResolvedValue({
    ok: true, status: 200,
    json: async () => ({ code: 'XTEST' }),
  })
  global.WebSocket = MockWebSocket

  render(<App />)
  const user = userEvent.setup()

  const nameInput = screen.getByPlaceholderText(/teacher name/i)
  await user.clear(nameInput)
  await user.type(nameInput, 'Prof. Smith')
  await user.click(screen.getByRole('button', { name: /host session/i }))

  await waitFor(() => expect(capturedWs).not.toBeNull())
  await act(async () => { capturedWs.triggerOpen() })
  await act(async () => { capturedWs.triggerMessage({ type: 'welcome', payload: welcomePayload }) })

  return user
}

async function mountAndJoinAsStudent() {
  setStudentAuth()
  global.fetch = vi.fn().mockResolvedValue({
    ok: true, status: 200, json: async () => ({}),
  })
  global.WebSocket = MockWebSocket

  render(<App />)
  const user = userEvent.setup()

  // Name is pre-filled from localStorage; just fill session code and join
  const codeInput = screen.getByPlaceholderText(/ABC123/i)
  await user.clear(codeInput)
  await user.type(codeInput, 'XTEST')
  await user.click(screen.getByRole('button', { name: /join session/i }))

  await waitFor(() => expect(capturedWs).not.toBeNull())
  await act(async () => { capturedWs.triggerOpen() })
  await act(async () => { capturedWs.triggerMessage({ type: 'welcome', payload: welcomePayload }) })

  return user
}

// ─── Tests: teacher session ───────────────────────────────────────────────────

describe('App — WebSocket session flow (teacher)', () => {
  beforeEach(() => {
    capturedWs = null
    window.localStorage.clear()
    vi.restoreAllMocks()
    global.Notification = class { constructor() {} static requestPermission = vi.fn().mockResolvedValue('granted') }
    global.Notification.permission = 'granted'
  })

  it('enters session view after WS open + welcome', async () => {
    await mountAndJoinAsTeacher()
    expect(screen.getByRole('button', { name: /end session/i })).toBeInTheDocument()
  })

  it('displays student count from welcome metrics', async () => {
    await mountAndJoinAsTeacher()
    // welcomePayload has student_count: 3 — rendered in multiple metric pills
    expect(screen.getAllByText('3')[0]).toBeInTheDocument()
  })

  it('updates student count when metrics message arrives', async () => {
    await mountAndJoinAsTeacher()
    await act(async () => {
      capturedWs.triggerMessage({
        type: 'metrics',
        payload: { confusion_count: 4, confusion_level_percent: 60, break_votes: 2, student_count: 12 },
      })
    })
    await waitFor(() => expect(screen.getAllByText('12')[0]).toBeInTheDocument())
  })

  it('shows a quiz when quiz message arrives', async () => {
    await mountAndJoinAsTeacher()
    await act(async () => {
      capturedWs.triggerMessage({
        type: 'quiz',
        payload: {
          question: 'What is the powerhouse of the cell?',
          options: [
            { id: 'A', text: 'Nucleus' },
            { id: 'B', text: 'Mitochondria' },
            { id: 'C', text: 'Ribosome' },
            { id: 'D', text: 'Golgi apparatus' },
          ],
          correct_option_id: 'B',
        },
      })
    })
    await waitFor(() =>
      expect(screen.getByText(/powerhouse of the cell/i)).toBeInTheDocument(),
    )
  })

  it('activates break banner when break_started message arrives', async () => {
    await mountAndJoinAsTeacher()
    await act(async () => {
      capturedWs.triggerMessage({
        type: 'break_started',
        payload: { end_time_epoch: Date.now() / 1000 + 600, focus_period_ends_at: 0 },
      })
    })
    await waitFor(() => expect(screen.getAllByText(/break active/i)[0]).toBeInTheDocument())
  })

  it('status says "Break ended" after break_ended message', async () => {
    await mountAndJoinAsTeacher()
    await act(async () => {
      capturedWs.triggerMessage({
        type: 'break_started',
        payload: { end_time_epoch: Date.now() / 1000 + 600 },
      })
    })
    await act(async () => {
      capturedWs.triggerMessage({ type: 'break_ended', payload: {} })
    })
    await waitFor(() => expect(screen.getAllByText(/break ended/i)[0]).toBeInTheDocument())
  })

  it('shows server error message in the UI', async () => {
    await mountAndJoinAsTeacher()
    await act(async () => {
      capturedWs.triggerMessage({
        type: 'error',
        payload: { message: 'AI generation quota exceeded' },
      })
    })
    await waitFor(() =>
      expect(screen.getAllByText(/AI generation quota exceeded/i)[0]).toBeInTheDocument(),
    )
  })

  it('shows fallback error text when error payload is missing message', async () => {
    await mountAndJoinAsTeacher()
    await act(async () => {
      capturedWs.triggerMessage({ type: 'error', payload: {} })
    })
    await waitFor(() =>
      expect(screen.getAllByText(/unknown session error/i)[0]).toBeInTheDocument(),
    )
  })

  it('updates anonymous question pending count on anonymous_questions message', async () => {
    await mountAndJoinAsTeacher()
    await act(async () => {
      capturedWs.triggerMessage({
        type: 'anonymous_questions',
        payload: {
          pending_count: 2,
          questions: [
            { id: 'q1', text: 'Can you explain again?', resolved: false, created_at: '' },
            { id: 'q2', text: 'What is the formula?', resolved: false, created_at: '' },
          ],
        },
      })
    })
    await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument())
  })

  it('shows screen_explanation via session notes area', async () => {
    await mountAndJoinAsTeacher()
    await act(async () => {
      capturedWs.triggerMessage({
        type: 'notes',
        payload: { text: 'Topic: photosynthesis light reactions' },
      })
    })
    // Open the notes panel to see the updated textarea value
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /shared notes/i }))
    await waitFor(() =>
      expect(
        screen.getByDisplayValue(/photosynthesis light reactions/i),
      ).toBeInTheDocument(),
    )
  })

  it('returns to pre-session lobby when WebSocket closes', async () => {
    await mountAndJoinAsTeacher()
    await act(async () => { capturedWs.close() })
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/teacher name/i)).toBeInTheDocument(),
    )
  })

  it('shows WS connection error message', async () => {
    setTeacherAuth()
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ code: 'ERR01' }),
    })
    global.WebSocket = MockWebSocket
    render(<App />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /host session/i }))
    await waitFor(() => expect(capturedWs).not.toBeNull())
    await act(async () => { capturedWs.triggerError() })
    await waitFor(() =>
      expect(screen.getAllByText(/websocket connection failed/i)[0]).toBeInTheDocument(),
    )
  })

  it('validates that teacher name is required before creating session', async () => {
    setTeacherAuth()
    global.fetch = vi.fn()
    render(<App />)
    const user = userEvent.setup()
    const nameInput = screen.getByPlaceholderText(/teacher name/i)
    await user.clear(nameInput)
    await user.click(screen.getByRole('button', { name: /host session/i }))
    await waitFor(() =>
      expect(screen.getAllByText(/teacher name is required/i)[0]).toBeInTheDocument(),
    )
    const createSessionCalls = global.fetch.mock.calls.filter(([url, init]) =>
      String(url).includes('/api/sessions')
      && !String(url).includes('/api/sessions/rejoin-status')
      && String(init?.method || 'GET').toUpperCase() === 'POST',
    )
    expect(createSessionCalls).toHaveLength(0)
  })

  it('handles session_state message and updates metrics', async () => {
    await mountAndJoinAsTeacher()
    await act(async () => {
      capturedWs.triggerMessage({
        type: 'session_state',
        payload: {
          notes: '',
          quiz: null,
          metrics: { confusion_count: 7, confusion_level_percent: 90, break_votes: 5, student_count: 20 },
          quiz_state: { hidden: false, cover_mode: true, voting_closed: false, answer_revealed: false },
          break_active_until: null,
          focus_period_ends_at: 0,
        },
      })
    })
    await waitFor(() => expect(screen.getAllByText('20')[0]).toBeInTheDocument())
  })
})

// ─── Tests: student session ───────────────────────────────────────────────────

describe('App — WebSocket session flow (student)', () => {
  beforeEach(() => {
    capturedWs = null
    window.localStorage.clear()
    vi.restoreAllMocks()
    global.Notification = class { constructor() {} static requestPermission = vi.fn().mockResolvedValue('granted') }
    global.Notification.permission = 'granted'
  })

  it('enters session view with confusion signal button', async () => {
    await mountAndJoinAsStudent()
    expect(
      screen.getByRole('button', { name: /signal confusion to teacher/i }),
    ).toBeInTheDocument()
  })

  it('shows quiz when quiz message arrives', async () => {
    await mountAndJoinAsStudent()
    await act(async () => {
      capturedWs.triggerMessage({
        type: 'quiz',
        payload: {
          question: 'Which planet is closest to the Sun?',
          options: [
            { id: 'A', text: 'Venus' },
            { id: 'B', text: 'Mercury' },
            { id: 'C', text: 'Mars' },
            { id: 'D', text: 'Earth' },
          ],
          correct_option_id: 'B',
        },
      })
    })
    await waitFor(() =>
      expect(screen.getByText(/closest to the Sun/i)).toBeInTheDocument(),
    )
  })

  it('sends confusion message over WebSocket when button clicked', async () => {
    await mountAndJoinAsStudent()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /signal confusion to teacher/i }))
    expect(capturedWs._sent.some((m) => m.type === 'confusion')).toBe(true)
  })

  it('shows screen_explanation text when server sends it', async () => {
    await mountAndJoinAsStudent()
    await act(async () => {
      capturedWs.triggerMessage({
        type: 'screen_explanation',
        payload: { text: 'This slide covers the water cycle.', generated_at: '' },
      })
    })
    await waitFor(() =>
      expect(screen.getByText(/water cycle/i)).toBeInTheDocument(),
    )
  })

  it('closes ask-question panel after server acknowledges submission', async () => {
    await mountAndJoinAsStudent()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /ask anonymous question/i }))
    // Panel should be open
    expect(
      screen.getByPlaceholderText(/explain why this formula/i),
    ).toBeInTheDocument()

    // Server acknowledges
    await act(async () => {
      capturedWs.triggerMessage({ type: 'anonymous_question_submitted', payload: {} })
    })
    await waitFor(() =>
      expect(
        screen.queryByPlaceholderText(/explain why this formula/i),
      ).not.toBeInTheDocument(),
    )
  })

  it('activates break countdown when break_started message arrives (student)', async () => {
    await mountAndJoinAsStudent()
    await act(async () => {
      capturedWs.triggerMessage({
        type: 'break_started',
        payload: { end_time_epoch: Date.now() / 1000 + 600 },
      })
    })
    await waitFor(() => expect(screen.getAllByText(/break active/i)[0]).toBeInTheDocument())
  })

  it('shows error message from server', async () => {
    await mountAndJoinAsStudent()
    await act(async () => {
      capturedWs.triggerMessage({
        type: 'error',
        payload: { message: 'Session has ended' },
      })
    })
    await waitFor(() =>
      expect(screen.getAllByText(/session has ended/i)[0]).toBeInTheDocument(),
    )
  })
})
