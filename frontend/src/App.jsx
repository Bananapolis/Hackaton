import { useEffect, useMemo, useRef, useState } from 'react'
import { config } from './config'
import { CountdownBanner } from './components/CountdownBanner'
import { QuizOverlay } from './components/QuizOverlay'
import { StatCard } from './components/StatCard'

const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }

async function postJson(path, body) {
  const response = await fetch(`${config.apiBase}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || `Request failed with status ${response.status}`)
  }

  return response.json()
}

function App() {
  const [role, setRole] = useState('student')
  const [name, setName] = useState('')
  const [sessionCode, setSessionCode] = useState('')
  const [joined, setJoined] = useState(false)
  const [clientId, setClientId] = useState('')
  const [status, setStatus] = useState('Ready')
  const [error, setError] = useState('')

  const [metrics, setMetrics] = useState({ confusion_count: 0, break_votes: 0, student_count: 0 })
  const [notes, setNotes] = useState('')
  const [breakEndTime, setBreakEndTime] = useState(null)
  const [quiz, setQuiz] = useState(null)
  const [quizProgress, setQuizProgress] = useState(null)
  const [analytics, setAnalytics] = useState(null)

  const wsRef = useRef(null)
  const localStreamRef = useRef(null)
  const peerConnectionsRef = useRef(new Map())
  const localVideoRef = useRef(null)
  const remoteVideoRef = useRef(null)

  const isTeacher = role === 'teacher'

  const wsUrl = useMemo(() => {
    if (!sessionCode) return ''
    const params = new URLSearchParams({ role, name })
    return `${config.wsBase}/ws/${sessionCode.toUpperCase()}?${params.toString()}`
  }, [name, role, sessionCode])

  useEffect(() => {
    return () => {
      wsRef.current?.close()
      for (const pc of peerConnectionsRef.current.values()) {
        pc.close()
      }
      peerConnectionsRef.current.clear()
      localStreamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  async function createSession() {
    setError('')
    if (!name.trim()) {
      setError('Teacher name is required')
      return
    }

    try {
      const data = await postJson('/api/sessions', { teacher_name: name.trim() })
      setRole('teacher')
      setSessionCode(data.code)
      setStatus(`Session ${data.code} created. Click Join session.`)
    } catch (err) {
      setError(err.message)
    }
  }

  function connectWebSocket() {
    setError('')

    if (!name.trim()) {
      setError('Name is required')
      return
    }
    if (!sessionCode.trim()) {
      setError('Session code is required')
      return
    }

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      setJoined(true)
      setStatus('Connected to live session')
    }

    ws.onclose = () => {
      setJoined(false)
      setStatus('Disconnected')
      for (const pc of peerConnectionsRef.current.values()) {
        pc.close()
      }
      peerConnectionsRef.current.clear()
    }

    ws.onerror = () => {
      setError('WebSocket connection failed')
    }

    ws.onmessage = async (event) => {
      const message = JSON.parse(event.data)

      if (message.type === 'welcome') {
        setClientId(message.payload.client_id)
        setNotes(message.payload.notes || '')
        setQuiz(message.payload.quiz || null)
        if (message.payload.break_active_until) {
          setBreakEndTime(message.payload.break_active_until)
        }
      }

      if (message.type === 'metrics') {
        setMetrics(message.payload)
      }

      if (message.type === 'break_started') {
        setBreakEndTime(message.payload.end_time_epoch)
      }

      if (message.type === 'notes') {
        setNotes(message.payload.text || '')
      }

      if (message.type === 'quiz') {
        setQuiz(message.payload)
      }

      if (message.type === 'quiz_progress') {
        setQuizProgress(message.payload)
      }

      if (message.type === 'analytics') {
        setAnalytics(message.payload)
      }

      if (message.type === 'error') {
        setError(message.payload?.message || 'Unknown session error')
      }

      if (message.type === 'break_threshold_reached') {
        setStatus(`Break threshold reached (${Math.round(message.payload.ratio * 100)}%)`)
      }

      if (message.type === 'student_joined' && isTeacher) {
        const studentId = message.payload.student_id
        await createOfferForStudent(studentId)
      }

      if (message.type === 'student_left' && isTeacher) {
        const studentId = message.payload.student_id
        const pc = peerConnectionsRef.current.get(studentId)
        if (pc) {
          pc.close()
          peerConnectionsRef.current.delete(studentId)
        }
      }

      if (message.type === 'signal') {
        await handleSignal(message.payload)
      }
    }
  }

  function send(type, payload = {}) {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    wsRef.current.send(JSON.stringify({ type, payload }))
  }

  async function startShare() {
    if (!isTeacher) return

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      })
      localStreamRef.current = stream
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream
      }
      setStatus('Screen sharing started')

      for (const track of stream.getTracks()) {
        track.onended = () => {
          setStatus('Screen sharing stopped')
        }
      }

      for (const [studentId, pc] of peerConnectionsRef.current) {
        for (const track of stream.getTracks()) {
          pc.addTrack(track, stream)
        }
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        send('signal', { target_id: studentId, description: offer })
      }
    } catch {
      setError('Screen share permission denied or unavailable')
    }
  }

  async function createPeerConnection(targetId) {
    let pc = peerConnectionsRef.current.get(targetId)
    if (pc) return pc

    pc = new RTCPeerConnection(rtcConfig)
    peerConnectionsRef.current.set(targetId, pc)

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        send('signal', {
          target_id: targetId,
          candidate: event.candidate,
        })
      }
    }

    pc.ontrack = (event) => {
      if (!isTeacher && remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0]
      }
    }

    if (isTeacher && localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        pc.addTrack(track, localStreamRef.current)
      }
    }

    return pc
  }

  async function createOfferForStudent(studentId) {
    const pc = await createPeerConnection(studentId)
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    send('signal', { target_id: studentId, description: offer })
  }

  async function handleSignal(payload) {
    const fromId = payload.from_id
    const pc = await createPeerConnection(fromId)

    if (payload.description) {
      const description = new RTCSessionDescription(payload.description)
      await pc.setRemoteDescription(description)

      if (description.type === 'offer') {
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        send('signal', { target_id: fromId, description: answer })
      }
    }

    if (payload.candidate) {
      await pc.addIceCandidate(new RTCIceCandidate(payload.candidate))
    }
  }

  function disconnect() {
    wsRef.current?.close()
    setJoined(false)
  }

  function requestAnalytics() {
    send('request_analytics')
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <h1 className="mb-2 text-2xl font-bold">Real-Time Educational Engagement MVP</h1>
        <p className="mb-6 text-slate-400">WebRTC live sharing with anonymous engagement, break votes, notes, and AI quizzes.</p>

        <CountdownBanner endTimeEpoch={breakEndTime} />

        <div className="grid gap-4 lg:grid-cols-[300px,1fr]">
          <aside className="rounded-xl border border-slate-700 bg-slate-900/70 p-4">
            <h2 className="mb-3 text-lg font-semibold">Session Controls</h2>

            <label className="mb-1 block text-sm">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="mb-3 w-full rounded border border-slate-600 bg-slate-800 px-2 py-2"
              disabled={joined}
            >
              <option value="student">Student</option>
              <option value="teacher">Teacher</option>
            </select>

            <label className="mb-1 block text-sm">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mb-3 w-full rounded border border-slate-600 bg-slate-800 px-2 py-2"
              placeholder={isTeacher ? 'Teacher name' : 'Student name'}
              disabled={joined}
            />

            <label className="mb-1 block text-sm">Session code</label>
            <input
              value={sessionCode}
              onChange={(e) => setSessionCode(e.target.value.toUpperCase())}
              className="mb-3 w-full rounded border border-slate-600 bg-slate-800 px-2 py-2"
              placeholder="ABC123"
              disabled={joined}
            />

            {!joined ? (
              <div className="space-y-2">
                {isTeacher ? (
                  <button
                    type="button"
                    onClick={createSession}
                    className="w-full rounded bg-indigo-600 px-3 py-2 font-medium hover:bg-indigo-500"
                  >
                    Create session
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={connectWebSocket}
                  className="w-full rounded bg-emerald-600 px-3 py-2 font-medium hover:bg-emerald-500"
                >
                  Join session
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={disconnect}
                className="w-full rounded bg-red-600 px-3 py-2 font-medium hover:bg-red-500"
              >
                Leave session
              </button>
            )}

            <div className="mt-3 rounded border border-slate-700 bg-slate-800/70 p-2 text-xs text-slate-300">
              <div>Status: {status}</div>
              <div>Client: {clientId || '-'}</div>
            </div>

            {error ? <div className="mt-2 rounded border border-red-500 bg-red-500/10 p-2 text-sm text-red-200">{error}</div> : null}
          </aside>

          <main className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <StatCard label="Students" value={metrics.student_count} />
              <StatCard label="Confusion alerts" value={metrics.confusion_count} />
              <StatCard label="Break votes" value={metrics.break_votes} help="Threshold: 40%" />
            </div>

            <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-3">
              <div className="mb-2 text-sm text-slate-400">Live stream</div>
              {isTeacher ? (
                <video ref={localVideoRef} autoPlay muted playsInline className="w-full rounded bg-black" />
              ) : (
                <video ref={remoteVideoRef} autoPlay playsInline className="w-full rounded bg-black" />
              )}
            </div>

            {quiz ? <QuizOverlay quiz={quiz} readonly={isTeacher} onAnswer={(optionId) => send('quiz_answer', { option_id: optionId })} /> : null}

            <div className="grid gap-4 lg:grid-cols-2">
              <section className="rounded-xl border border-slate-700 bg-slate-900/70 p-3">
                <h3 className="mb-2 text-lg font-semibold">Notes</h3>
                <textarea
                  value={notes}
                  onChange={(e) => {
                    setNotes(e.target.value)
                    if (isTeacher) send('note_update', { text: e.target.value })
                  }}
                  disabled={!joined || !isTeacher}
                  className="h-32 w-full rounded border border-slate-600 bg-slate-800 px-2 py-2 text-sm"
                  placeholder={isTeacher ? 'Type lecture notes here…' : 'Teacher notes will appear here…'}
                />
              </section>

              <section className="rounded-xl border border-slate-700 bg-slate-900/70 p-3">
                <h3 className="mb-2 text-lg font-semibold">Actions</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {isTeacher ? (
                    <>
                      <button
                        type="button"
                        disabled={!joined}
                        onClick={startShare}
                        className="rounded bg-indigo-600 px-3 py-2 hover:bg-indigo-500 disabled:opacity-50"
                      >
                        Start screen share
                      </button>
                      <button
                        type="button"
                        disabled={!joined}
                        onClick={() => send('generate_quiz')}
                        className="rounded bg-violet-600 px-3 py-2 hover:bg-violet-500 disabled:opacity-50"
                      >
                        Generate quiz
                      </button>
                      <button
                        type="button"
                        disabled={!joined}
                        onClick={() => send('start_break', { duration_seconds: 300 })}
                        className="rounded bg-amber-600 px-3 py-2 hover:bg-amber-500 disabled:opacity-50"
                      >
                        Start 5-min break
                      </button>
                      <button
                        type="button"
                        disabled={!joined}
                        onClick={requestAnalytics}
                        className="rounded bg-cyan-600 px-3 py-2 hover:bg-cyan-500 disabled:opacity-50"
                      >
                        Refresh analytics
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={!joined}
                        onClick={() => send('confusion')}
                        className="rounded bg-red-600 px-3 py-2 hover:bg-red-500 disabled:opacity-50"
                      >
                        I'm confused
                      </button>
                      <button
                        type="button"
                        disabled={!joined}
                        onClick={() => send('break_vote')}
                        className="rounded bg-orange-600 px-3 py-2 hover:bg-orange-500 disabled:opacity-50"
                      >
                        Request break
                      </button>
                    </>
                  )}
                </div>
              </section>
            </div>

            {isTeacher && (quizProgress || analytics) ? (
              <section className="rounded-xl border border-slate-700 bg-slate-900/70 p-3">
                <h3 className="mb-2 text-lg font-semibold">Teacher analytics</h3>
                <div className="text-sm text-slate-300">
                  <div>Quiz answers: {quizProgress?.total_answers ?? analytics?.quiz?.total_answers ?? 0}</div>
                  <div>Correct answers: {quizProgress?.correct_answers ?? analytics?.quiz?.correct_answers ?? 0}</div>
                  <div>
                    Accuracy:{' '}
                    {Math.round(100 * (quizProgress?.accuracy ?? analytics?.quiz?.accuracy ?? 0))}%
                  </div>
                </div>
              </section>
            ) : null}
          </main>
        </div>
      </div>
    </div>
  )
}

export default App
