import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Coffee,
  Copy,
  Eye,
  EyeOff,
  FileText,
  HelpCircle,
  Lock,
  LockOpen,
  Maximize2,
  Minimize2,
  Monitor,
  Moon,
  Settings,
  Sparkles,
  Sun,
  Trophy,
  Users,
  X,
} from 'lucide-react'
import { config } from './config'
import { CountdownBanner } from './components/CountdownBanner'
import { QuizOverlay } from './components/QuizOverlay'
import { SessionQRCode } from './components/SessionQRCode'
import { StatCard } from './components/StatCard'

const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
const sessionPreferencesStorageKey = 'session-preferences-v1'
const CONFUSION_NOTIFICATION_THRESHOLD_PERCENT = 65
const CONFUSION_NOTIFICATION_RESET_PERCENT = 45
const BREAK_NOTIFICATION_COOLDOWN_MS = 45_000
const quizPromptPresets = [
  {
    id: 'default',
    label: 'Default',
    description: 'Balanced concept-check based on current screen and notes.',
  },
  {
    id: 'funny',
    label: 'Funny mood-lightener',
    description: 'Keeps it educational, but with a light classroom-safe playful tone.',
  },
  {
    id: 'challenge',
    label: 'Challenge question',
    description: 'Harder prompt that pushes reasoning instead of simple recall.',
  },
  {
    id: 'misconception',
    label: 'Misconception check',
    description: 'Targets common misunderstandings with plausible distractors.',
  },
  {
    id: 'real_world',
    label: 'Real-world application',
    description: 'Frames the question around practical usage or scenario thinking.',
  },
]

function loadSessionPreferences() {
  if (typeof window === 'undefined') {
    return { role: 'student', name: '', sessionCode: '' }
  }

  try {
    const raw = window.localStorage.getItem(sessionPreferencesStorageKey)
    if (!raw) {
      return { role: 'student', name: '', sessionCode: '' }
    }

    const parsed = JSON.parse(raw)
    const role = parsed?.role === 'teacher' ? 'teacher' : 'student'
    const name = typeof parsed?.name === 'string' ? parsed.name : ''
    const sessionCode = typeof parsed?.sessionCode === 'string' ? parsed.sessionCode.toUpperCase() : ''

    return { role, name, sessionCode }
  } catch {
    return { role: 'student', name: '', sessionCode: '' }
  }
}

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

function Icon({ name, className = 'h-5 w-5' }) {
  const icons = {
    settings: Settings,
    notes: FileText,
    awards: Trophy,
    sun: Sun,
    moon: Moon,
    screen: Monitor,
    maximize: Maximize2,
    minimize: Minimize2,
    quiz: Sparkles,
    break: Coffee,
    confusion: HelpCircle,
    users: Users,
    copy: Copy,
    close: X,
    alert: AlertTriangle,
    eye: Eye,
    eyeOff: EyeOff,
    lock: Lock,
    lockOpen: LockOpen,
  }
  const IconComponent = icons[name]
  if (!IconComponent) return null

  return <IconComponent className={className} strokeWidth={1.9} aria-hidden="true" />
}

function App() {
  const [initialSessionPreferences] = useState(() => loadSessionPreferences())

  const [role, setRole] = useState(initialSessionPreferences.role)
  const [theme, setTheme] = useState('light')
  const [name, setName] = useState(initialSessionPreferences.name)
  const [sessionCode, setSessionCode] = useState(initialSessionPreferences.sessionCode)
  const [joined, setJoined] = useState(false)
  const [clientId, setClientId] = useState('')
  const [status, setStatus] = useState('Ready')
  const [error, setError] = useState('')

  const [metrics, setMetrics] = useState({
    confusion_count: 0,
    confusion_level_percent: 0,
    break_votes: 0,
    student_count: 0,
  })
  const [notes, setNotes] = useState('')
  const [breakEndTime, setBreakEndTime] = useState(null)
  const [quiz, setQuiz] = useState(null)
  const [quizState, setQuizState] = useState({ hidden: false, cover_mode: true, voting_closed: false })
  const [quizProgress, setQuizProgress] = useState(null)
  const [analytics, setAnalytics] = useState(null)
  const [endingSession, setEndingSession] = useState(false)
  const [selectedQuizOptionId, setSelectedQuizOptionId] = useState('')
  const [showSessionPanel, setShowSessionPanel] = useState(true)
  const [showNotesPanel, setShowNotesPanel] = useState(false)
  const [showAwardsPanel, setShowAwardsPanel] = useState(false)
  const [screenExplanation, setScreenExplanation] = useState('')
  const [screenExplanationGeneratedAt, setScreenExplanationGeneratedAt] = useState('')
  const [explainLoading, setExplainLoading] = useState(false)
  const [showQuizPromptPanel, setShowQuizPromptPanel] = useState(false)
  const [selectedQuizPreset, setSelectedQuizPreset] = useState('default')
  const [quizCustomPrompt, setQuizCustomPrompt] = useState('')
  const [quizGenerationPending, setQuizGenerationPending] = useState(false)
  const [isScreenMaximized, setIsScreenMaximized] = useState(false)

  const wsRef = useRef(null)
  const localStreamRef = useRef(null)
  const peerConnectionsRef = useRef(new Map())
  const localVideoRef = useRef(null)
  const remoteVideoRef = useRef(null)
  const stageContainerRef = useRef(null)
  const notificationPermissionRequestedRef = useRef(false)
  const confusionNotificationArmedRef = useRef(true)
  const lastBreakNotificationAtRef = useRef(0)

  const isTeacher = role === 'teacher'
  const normalizedCode = sessionCode.trim().toUpperCase()
  const themeToggleLabel = theme === 'dark' ? 'Switch to light' : 'Switch to dark'
  const joinUrl = useMemo(() => {
    if (!normalizedCode) return ''
    if (typeof window === 'undefined') return `?code=${encodeURIComponent(normalizedCode)}`

    const url = new URL(window.location.href)
    url.searchParams.set('code', normalizedCode)
    return url.toString()
  }, [normalizedCode])

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

  useEffect(() => {
    if (isTeacher && joined) {
      return
    }

    confusionNotificationArmedRef.current = true
    lastBreakNotificationAtRef.current = 0
  }, [isTeacher, joined])

  useEffect(() => {
    const persistedTheme = window.localStorage.getItem('ui-theme')
    if (persistedTheme === 'dark' || persistedTheme === 'light') {
      setTheme(persistedTheme)
    }
  }, [])

  useEffect(() => {
    if (!joined) {
      setShowSessionPanel(true)

      if (document.fullscreenElement === stageContainerRef.current) {
        document.exitFullscreen().catch(() => {})
      }

      setIsScreenMaximized(false)
    }
  }, [joined])

  useEffect(() => {
    const syncFullscreenState = () => {
      const fullscreenElement = document.fullscreenElement
      setIsScreenMaximized(fullscreenElement === stageContainerRef.current)
    }

    document.addEventListener('fullscreenchange', syncFullscreenState)
    return () => document.removeEventListener('fullscreenchange', syncFullscreenState)
  }, [])

  useEffect(() => {
    if (!joined) return undefined

    const timer = window.setInterval(() => {
      send('request_state')
    }, 2000)

    return () => window.clearInterval(timer)
  }, [joined])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const params = new URLSearchParams(window.location.search)
    const codeFromUrl = (params.get('code') || '').trim().toUpperCase()
    if (!codeFromUrl) return

    setSessionCode(codeFromUrl)
    setStatus(`Session code ${codeFromUrl} loaded from URL`)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const preferences = {
      role,
      name,
      sessionCode: sessionCode.toUpperCase(),
    }
    window.localStorage.setItem(sessionPreferencesStorageKey, JSON.stringify(preferences))
  }, [role, name, sessionCode])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const url = new URL(window.location.href)
    if (normalizedCode) {
      url.searchParams.set('code', normalizedCode)
    } else {
      url.searchParams.delete('code')
    }
    window.history.replaceState({}, '', url)
  }, [normalizedCode])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    window.localStorage.setItem('ui-theme', theme)
  }, [theme])

  useEffect(() => {
    if (!isTeacher || !joined) return

    const confusionPercent = Math.max(
      0,
      Math.min(100, Number(metrics.confusion_level_percent ?? metrics.confusion_count ?? 0)),
    )

    if (
      confusionNotificationArmedRef.current &&
      confusionPercent >= CONFUSION_NOTIFICATION_THRESHOLD_PERCENT
    ) {
      notifyTeacher(
        'High confusion level detected',
        `Class confusion is at ${Math.round(confusionPercent)}%. Consider pausing to clarify.`,
        'teacher-confusion-high',
      )
      confusionNotificationArmedRef.current = false
    }

    if (confusionPercent <= CONFUSION_NOTIFICATION_RESET_PERCENT) {
      confusionNotificationArmedRef.current = true
    }
  }, [isTeacher, joined, metrics.confusion_count, metrics.confusion_level_percent])

  async function ensureTeacherNotificationPermission(nextRole) {
    if (typeof window === 'undefined') return
    if (nextRole !== 'teacher') return
    if (!(window.Notification && typeof window.Notification.requestPermission === 'function')) return
    if (Notification.permission !== 'default') return
    if (notificationPermissionRequestedRef.current) return

    notificationPermissionRequestedRef.current = true
    try {
      await Notification.requestPermission()
    } catch {
      // Ignore permission request failures; app remains fully functional without notifications.
    }
  }

  function notifyTeacher(title, body, tag) {
    if (typeof window === 'undefined') return
    if (!(window.Notification && Notification.permission === 'granted')) return

    try {
      new Notification(title, {
        body,
        tag,
        renotify: true,
      })
    } catch {
      // Ignore notification failures in unsupported browser states.
    }
  }

  async function createSession() {
    setError('')
    void ensureTeacherNotificationPermission('teacher')
    const teacherName = name.trim()
    if (!teacherName) {
      setError('Teacher name is required')
      return
    }

    try {
      const data = await postJson('/api/sessions', { teacher_name: teacherName })
      const newCode = data.code.toUpperCase()
      setRole('teacher')
      setName(teacherName)
      setSessionCode(newCode)
      setStatus(`Session ${newCode} created. Joining…`)
      connectWebSocket({ nextRole: 'teacher', nextName: teacherName, nextSessionCode: newCode })
    } catch (err) {
      setError(err.message)
    }
  }

  function connectWebSocket({ nextRole = role, nextName = name, nextSessionCode = sessionCode } = {}) {
    setError('')
    void ensureTeacherNotificationPermission(nextRole)

    const trimmedName = nextName.trim()
    const normalizedSessionCode = nextSessionCode.trim().toUpperCase()

    if (!trimmedName) {
      setError('Name is required')
      return
    }
    if (!normalizedSessionCode) {
      setError('Session code is required')
      return
    }

    const params = new URLSearchParams({ role: nextRole, name: trimmedName })
    const wsUrl = `${config.wsBase}/ws/${normalizedSessionCode}?${params.toString()}`

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      setJoined(true)
      setStatus('Connected to live session')
    }

    ws.onclose = () => {
      setJoined(false)
      setStatus('Disconnected')
      setExplainLoading(false)
      setQuizGenerationPending(false)
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
        setMetrics(
          message.payload.metrics || {
            confusion_count: 0,
            confusion_level_percent: 0,
            break_votes: 0,
            student_count: 0,
          },
        )
        setQuizState(
          message.payload.quiz_state || { hidden: false, cover_mode: true, voting_closed: false },
        )
        if (message.payload.break_active_until) {
          setBreakEndTime(message.payload.break_active_until)
        } else {
          setBreakEndTime(null)
        }
      }

      if (message.type === 'session_state') {
        const nextState = message.payload || {}
        setNotes(nextState.notes || '')
        setQuiz(nextState.quiz || null)
        setMetrics(
          nextState.metrics || {
            confusion_count: 0,
            confusion_level_percent: 0,
            break_votes: 0,
            student_count: 0,
          },
        )
        setQuizState(nextState.quiz_state || { hidden: false, cover_mode: true, voting_closed: false })
        if (nextState.break_active_until) {
          setBreakEndTime(nextState.break_active_until)
        } else {
          setBreakEndTime(null)
        }
      }

      if (message.type === 'metrics') {
        setMetrics(message.payload)
      }

      if (message.type === 'break_started') {
        setBreakEndTime(message.payload.end_time_epoch)
        setStatus('Break timer updated')
      }

      if (message.type === 'break_ended') {
        setBreakEndTime(null)
        setStatus('Break ended')
      }

      if (message.type === 'notes') {
        setNotes(message.payload.text || '')
      }

      if (message.type === 'quiz') {
        setQuiz(message.payload)
        setQuizState({ hidden: false, cover_mode: true, voting_closed: false })
        setSelectedQuizOptionId('')
        setQuizGenerationPending(false)
      }

      if (message.type === 'quiz_state') {
        setQuizState((current) => ({ ...current, ...(message.payload || {}) }))
      }

      if (message.type === 'quiz_progress') {
        setQuizProgress(message.payload)
      }

      if (message.type === 'analytics') {
        setAnalytics(message.payload)
      }

      if (message.type === 'session_ended') {
        setAnalytics(message.payload?.analytics || null)
        setStatus('Session ended by teacher')
        ws.close()
      }

      if (message.type === 'error') {
        setExplainLoading(false)
        setQuizGenerationPending(false)
        setError(message.payload?.message || 'Unknown session error')
      }

      if (message.type === 'screen_explanation') {
        setExplainLoading(false)
        setScreenExplanation(message.payload?.text || '')
        setScreenExplanationGeneratedAt(message.payload?.generated_at || '')
        setStatus('AI explanation ready')
      }

      if (message.type === 'break_threshold_reached') {
        const ratioPercent = Math.round((message.payload?.ratio || 0) * 100)
        setStatus(`Break threshold reached (${ratioPercent}%)`)
        const now = Date.now()
        if (now - lastBreakNotificationAtRef.current > BREAK_NOTIFICATION_COOLDOWN_MS) {
          notifyTeacher(
            'Students requested a break',
            `${ratioPercent}% voted for a break. Consider starting one now.`,
            'teacher-break-threshold',
          )
          lastBreakNotificationAtRef.current = now
        }
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

  function captureVideoFrame(video) {
    if (!video) return null

    const width = video.videoWidth
    const height = video.videoHeight
    if (!width || !height) return null

    const maxWidth = 1280
    const scale = width > maxWidth ? maxWidth / width : 1
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))

    const context = canvas.getContext('2d')
    if (!context) return null
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.8)
  }

  function captureSharedScreenScreenshot() {
    return captureVideoFrame(localVideoRef.current)
  }

  function captureCurrentViewScreenshot() {
    return captureVideoFrame(isTeacher ? localVideoRef.current : remoteVideoRef.current)
  }

  function submitQuizAnswer(optionId) {
    if (!joined || isTeacher || selectedQuizOptionId || quizState.voting_closed) return
    setSelectedQuizOptionId(optionId)
    send('quiz_answer', { option_id: optionId })
    setStatus(`Quiz answer submitted: ${optionId}`)
  }

  function generateQuizFromCurrentScreen() {
    if (!joined || !isTeacher) return
    const screenshotDataUrl = captureSharedScreenScreenshot()
    if (!screenshotDataUrl) {
      setError('Start screen share first so a screenshot can be captured for quiz generation.')
      return
    }

    const customPrompt = quizCustomPrompt.trim()
    setQuizGenerationPending(true)
    setShowQuizPromptPanel(false)
    setStatus('Generating quiz from current screen…')
    send('generate_quiz', {
      notes,
      screenshot_data_url: screenshotDataUrl,
      quiz_preset: selectedQuizPreset,
      quiz_custom_prompt: customPrompt,
    })
  }

  function explainCurrentScreen() {
    if (!joined || isTeacher || explainLoading) return

    const screenshotDataUrl = captureCurrentViewScreenshot()
    if (!screenshotDataUrl) {
      setError('No shared screen frame available yet. Wait for the teacher screen to load and try again.')
      return
    }

    setError('')
    setExplainLoading(true)
    setStatus('Generating AI explanation...')
    send('explain_screen', {
      notes,
      screenshot_data_url: screenshotDataUrl,
    })
  }

  function closeQuiz() {
    if (!joined || !isTeacher || !quiz) return
    send('quiz_control', { hidden: true })
    setQuizState((current) => ({ ...current, hidden: true }))
    setQuiz(null)
    setSelectedQuizOptionId('')
    setStatus('Quiz closed')
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
    setExplainLoading(false)
  }

  function requestAnalytics() {
    send('request_analytics')
  }

  function openAwardsPanel() {
    if (isTeacher && joined) {
      requestAnalytics()
    }
    setShowAwardsPanel(true)
  }

  function startBreak(durationSeconds = 300) {
    send('start_break', { duration_seconds: durationSeconds })
  }

  function adjustBreak(deltaSeconds) {
    send('break_control', { action: 'adjust', delta_seconds: deltaSeconds })
  }

  function cancelBreak() {
    send('break_control', { action: 'cancel' })
  }

  function downloadJsonReport(report, sessionCodeForFile) {
    const reportBlob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const blobUrl = URL.createObjectURL(reportBlob)
    const link = document.createElement('a')
    link.href = blobUrl
    link.download = `session-${sessionCodeForFile}-analytics-report.json`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(blobUrl)
  }

  async function toggleStageFullscreen() {
    const container = stageContainerRef.current
    if (!container) return

    try {
      const report = await postJson(`/api/sessions/${encodeURIComponent(normalizedCode)}/end`, {})
      setAnalytics(report.analytics || null)
      setStatus('Session ended. Full analytics report downloaded.')
      setShowAwardsPanel(true)
      downloadJsonReport(report, normalizedCode)
    } catch (err) {
      setError(err.message)
    } finally {
      setEndingSession(false)
      if (document.fullscreenElement === container) {
        await document.exitFullscreen()
      } else if (!document.fullscreenElement) {
        await container.requestFullscreen()
      }
    } catch {
      setError('Fullscreen is unavailable on this browser/device.')
    }
  }

  async function copySessionCode() {
    if (!normalizedCode) return
    try {
      await navigator.clipboard.writeText(normalizedCode)
      setStatus(`Session code ${normalizedCode} copied`)
    } catch {
      setError('Could not copy session code. Please copy manually.')
    }
  }

  async function copyJoinLink() {
    if (!joinUrl) return
    try {
      await navigator.clipboard.writeText(joinUrl)
      setStatus('Student join link copied')
    } catch {
      setError('Could not copy student join link. Please copy manually.')
    }
  }

  const accuracyValue = Math.round(100 * (quizProgress?.accuracy ?? analytics?.quiz?.accuracy ?? 0))
  const confusionLevelPercent = Math.max(
    0,
    Math.min(100, Number(metrics.confusion_level_percent ?? metrics.confusion_count ?? 0)),
  )
  const breakVotePercent = Math.max(
    0,
    Math.min(
      100,
      metrics.student_count > 0 ? (Number(metrics.break_votes ?? 0) / Number(metrics.student_count)) * 100 : 0,
    ),
  )
  const confusionMetricDisplay = `${Math.round(confusionLevelPercent)}%`
  const breakVotesMetricDisplay = `${metrics.break_votes} (${Math.round(breakVotePercent)}%)`
  const awards = Array.isArray(analytics?.awards) ? analytics.awards : []
  const shortStatus = status.length > 54 ? `${status.slice(0, 54)}…` : status
  const breakIsActive = Boolean(breakEndTime && breakEndTime > Date.now() / 1000)
  const compactMetrics = [
    { label: 'Students', value: metrics.student_count, icon: 'users' },
    { label: 'Confusion level', value: confusionMetricDisplay, icon: 'alert' },
    { label: 'Break votes', value: breakVotesMetricDisplay, icon: 'break' },
  ]
  const roleLabel = isTeacher ? 'Teacher desk' : 'Student view'
  const quizVisible = Boolean(quiz) && !quizState.hidden
  const quizReadonly = isTeacher || quizState.voting_closed
  const stageControlsVisibilityClass = isScreenMaximized
    ? 'opacity-0 pointer-events-none transition-opacity duration-200 group-hover/stage:opacity-100 group-hover/stage:pointer-events-auto group-focus-within/stage:opacity-100 group-focus-within/stage:pointer-events-auto'
    : ''

  return (
    <div className="min-h-screen text-slate-900 transition-colors dark:text-slate-100">
      <div className="mx-auto flex min-h-screen w-full max-w-[1920px] flex-col px-3 py-3 lg:px-6 lg:py-5">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3 ui-fade-up">
          <div className="rounded-2xl border border-slate-200/80 bg-white/85 px-4 py-2.5 shadow-[0_18px_35px_-24px_rgba(15,23,42,0.65)] backdrop-blur-xl dark:border-slate-700/80 dark:bg-slate-900/75">
            <div className="hero-subtext text-[11px] uppercase tracking-[0.08em]">Live engagement studio</div>
            <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              {roleLabel}
            </div>
          </div>
          <div className="flex items-center gap-1.5 rounded-2xl border border-slate-200/90 bg-white/90 p-1.5 shadow-[0_16px_32px_-24px_rgba(15,23,42,0.9)] backdrop-blur-xl dark:border-slate-700 dark:bg-slate-900/75">
            <button
              type="button"
              onClick={() => setShowSessionPanel(true)}
              className="grid h-9 w-9 place-items-center rounded-xl border border-transparent text-slate-700 transition hover:border-slate-200 hover:bg-white dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800"
              title="Session settings"
              aria-label="Session settings"
            >
              <Icon name="settings" className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => setShowNotesPanel(true)}
              className="grid h-9 w-9 place-items-center rounded-xl border border-transparent text-slate-700 transition hover:border-slate-200 hover:bg-white dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800"
              title="Shared notes"
              aria-label="Shared notes"
            >
              <Icon name="notes" className="h-5 w-5" />
            </button>
            {isTeacher ? (
              <button
                type="button"
                onClick={openAwardsPanel}
                className="grid h-9 w-9 place-items-center rounded-xl border border-transparent text-slate-700 transition hover:border-slate-200 hover:bg-white dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800"
                title="Class awards"
                aria-label="Class awards"
              >
                <Icon name="awards" className="h-5 w-5" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
              className="grid h-9 w-9 place-items-center rounded-xl border border-transparent text-slate-700 transition hover:border-slate-200 hover:bg-white dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800"
              aria-label={themeToggleLabel}
              title={themeToggleLabel}
            >
              {theme === 'dark' ? <Icon name="sun" className="h-5 w-5" /> : <Icon name="moon" className="h-5 w-5" />}
            </button>
          </div>
        </header>

        <CountdownBanner endTimeEpoch={breakEndTime} />

        <main className="grid min-h-0 flex-1 gap-4 ui-fade-up lg:grid-cols-[minmax(0,1fr)_340px]">
          <section
            ref={stageContainerRef}
            className={`group/stage relative overflow-hidden border border-slate-300/65 bg-slate-950 shadow-[0_32px_70px_-40px_rgba(2,6,23,0.95)] ui-fade-up dark:border-slate-700/60 ${
              isScreenMaximized
                ? 'min-h-screen rounded-none border-0'
                : 'min-h-[60vh] rounded-[28px]'
            }`}
          >
            <div className="absolute left-4 top-4 z-20 flex flex-wrap items-center gap-2">
              <div className="rounded-full border border-white/20 bg-slate-950/75 px-3 py-1 text-xs font-medium text-slate-100 backdrop-blur" title={status}>
                {shortStatus}
              </div>
              <div className="rounded-full border border-sky-300/35 bg-sky-500/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-sky-100" title="Session code">
                {normalizedCode || 'No code'}
              </div>
              <div className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs text-slate-200">{roleLabel}</div>
            </div>

            <div className="absolute right-4 top-4 z-20 flex gap-1.5">
              {compactMetrics.map((item) => (
                <div
                  key={item.label}
                  className="rounded-full border border-white/20 bg-slate-950/70 px-2.5 py-1 text-xs text-slate-100 backdrop-blur"
                  title={`${item.label}: ${item.value}`}
                >
                  <span className="mr-1 inline-flex align-middle">
                    <Icon name={item.icon} className="h-3.5 w-3.5" />
                  </span>
                  {item.value}
                </div>
              ))}
            </div>

            <div className="relative h-full w-full bg-gradient-to-br from-slate-900 via-slate-950 to-slate-950">
              {isTeacher ? (
                <video ref={localVideoRef} autoPlay muted playsInline className="h-full w-full object-contain" />
              ) : (
                <video ref={remoteVideoRef} autoPlay playsInline className="h-full w-full object-contain" />
              )}

              {!joined ? (
                <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/40">
                  <div className="rounded-2xl border border-white/20 bg-black/65 px-5 py-3 text-sm text-white backdrop-blur">
                    Open Session settings to create or join a class.
                  </div>
                </div>
              ) : null}

              {quizVisible ? (
                <div
                  className={`absolute z-20 ${quizState.cover_mode ? 'inset-0 flex items-center justify-center bg-slate-950/55 backdrop-blur-md' : 'inset-x-4 bottom-24'}`}
                >
                  <QuizOverlay
                    quiz={quiz}
                    readonly={quizReadonly}
                    selectedOptionId={selectedQuizOptionId}
                    onAnswer={submitQuizAnswer}
                    large={quizState.cover_mode}
                    votingClosed={quizState.voting_closed}
                  />
                </div>
              ) : null}

              {isTeacher && quizVisible ? (
                <div className={`absolute right-4 bottom-24 z-20 ${stageControlsVisibilityClass}`}>
                  <div className="flex flex-col items-center gap-2 rounded-2xl border border-white/15 bg-white/90 p-2 shadow-2xl backdrop-blur-2xl dark:border-slate-700/80 dark:bg-slate-900/88">
                    <button
                      type="button"
                      disabled={!joined}
                      onClick={() => send('quiz_control', { cover_mode: !quizState.cover_mode })}
                      className="grid h-11 w-11 place-items-center rounded-xl bg-slate-800 text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                      title={quizState.cover_mode ? 'Uncover question' : 'Cover question'}
                      aria-label={quizState.cover_mode ? 'Uncover question' : 'Cover question'}
                    >
                      <Icon name={quizState.cover_mode ? 'eyeOff' : 'eye'} className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      disabled={!joined}
                      onClick={() => send('quiz_control', { voting_closed: !quizState.voting_closed })}
                      className="grid h-11 w-11 place-items-center rounded-xl bg-slate-700 text-white transition hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
                      title={quizState.voting_closed ? 'Resume voting' : 'Close voting'}
                      aria-label={quizState.voting_closed ? 'Resume voting' : 'Close voting'}
                    >
                      <Icon name={quizState.voting_closed ? 'lockOpen' : 'lock'} className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      disabled={!joined}
                      onClick={closeQuiz}
                      className="grid h-11 w-11 place-items-center rounded-xl bg-rose-600 text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
                      title="Close question"
                      aria-label="Close question"
                    >
                      <Icon name="close" className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              ) : null}

              <div className={`absolute bottom-4 left-1/2 z-20 -translate-x-1/2 ${stageControlsVisibilityClass}`}>
                <div className="flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/90 p-2 shadow-2xl backdrop-blur-2xl dark:border-slate-700/80 dark:bg-slate-900/88">
                  {isTeacher ? (
                    <>
                      <button
                        type="button"
                        disabled={!joined}
                        onClick={startShare}
                        className="grid h-11 w-11 place-items-center rounded-xl bg-slate-900 text-lg text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-slate-200"
                        title="Start screen share"
                        aria-label="Start screen share"
                      >
                        <Icon name="screen" className="h-5 w-5" />
                      </button>
                      <button
                        type="button"
                        disabled={!joined || quizGenerationPending}
                        onClick={() => {
                          setError('')
                          setShowQuizPromptPanel(true)
                        }}
                        className="grid h-11 w-11 place-items-center rounded-xl bg-sky-700 text-lg text-white transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-50"
                        title={quizGenerationPending ? 'Generating quiz...' : 'Generate quiz'}
                        aria-label={quizGenerationPending ? 'Generating quiz' : 'Generate quiz'}
                      >
                        <Icon name="quiz" className="h-5 w-5" />
                      </button>
                      <button
                        type="button"
                        disabled={!joined}
                        onClick={toggleStageFullscreen}
                        className="grid h-11 w-11 place-items-center rounded-xl bg-slate-700 text-lg text-white transition hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
                        title={isScreenMaximized ? 'Minimize shared screen' : 'Maximize shared screen'}
                        aria-label={isScreenMaximized ? 'Minimize shared screen' : 'Maximize shared screen'}
                      >
                        <Icon name={isScreenMaximized ? 'minimize' : 'maximize'} className="h-5 w-5" />
                      </button>
                      <button
                        type="button"
                        disabled={!joined}
                        onClick={() => startBreak(300)}
                        className="grid h-11 w-11 place-items-center rounded-xl bg-slate-700 text-lg text-white transition hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
                        title="Start 5-minute break"
                        aria-label="Start 5-minute break"
                      >
                        <Icon name="break" className="h-5 w-5" />
                      </button>
                      {breakIsActive ? (
                        <>
                          <button
                            type="button"
                            disabled={!joined}
                            onClick={() => adjustBreak(-60)}
                            className="grid h-11 min-w-11 place-items-center rounded-xl bg-slate-700 px-2 text-sm font-semibold text-white transition hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
                            title="Reduce break by 1 minute"
                            aria-label="Reduce break by 1 minute"
                          >
                            -1
                          </button>
                          <button
                            type="button"
                            disabled={!joined}
                            onClick={() => adjustBreak(60)}
                            className="grid h-11 min-w-11 place-items-center rounded-xl bg-slate-700 px-2 text-sm font-semibold text-white transition hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
                            title="Extend break by 1 minute"
                            aria-label="Extend break by 1 minute"
                          >
                            +1
                          </button>
                          <button
                            type="button"
                            disabled={!joined}
                            onClick={cancelBreak}
                            className="grid h-11 min-w-11 place-items-center rounded-xl bg-rose-600 px-2 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
                            title="End break now"
                            aria-label="End break now"
                          >
                            End
                          </button>
                        </>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={!joined}
                        onClick={() => {
                          send('confusion')
                          setStatus('Confusion signal sent')
                        }}
                        className="grid h-11 w-11 place-items-center rounded-xl bg-slate-800 text-lg text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                        title="Send confusion alert"
                        aria-label="Send confusion alert"
                      >
                        <Icon name="confusion" className="h-5 w-5" />
                      </button>
                      <button
                        type="button"
                        disabled={!joined}
                        onClick={() => send('break_vote')}
                        className="grid h-11 w-11 place-items-center rounded-xl bg-sky-700 text-lg text-white transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-50"
                        title="Request break"
                        aria-label="Request break"
                      >
                        <Icon name="break" className="h-5 w-5" />
                      </button>
                      <button
                        type="button"
                        disabled={!joined || explainLoading}
                        onClick={explainCurrentScreen}
                        className="grid h-11 w-11 place-items-center rounded-xl bg-sky-800 text-lg text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                        title="Explain the screen"
                        aria-label="Explain the screen"
                      >
                        <Icon name="quiz" className="h-5 w-5" />
                      </button>
                      <button
                        type="button"
                        disabled={!joined}
                        onClick={toggleStageFullscreen}
                        className="grid h-11 w-11 place-items-center rounded-xl bg-slate-700 text-lg text-white transition hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
                        title={isScreenMaximized ? 'Minimize shared screen' : 'Maximize shared screen'}
                        aria-label={isScreenMaximized ? 'Minimize shared screen' : 'Maximize shared screen'}
                      >
                        <Icon name={isScreenMaximized ? 'minimize' : 'maximize'} className="h-5 w-5" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </section>

          <aside
            className={`flex flex-col gap-3 rounded-[28px] border border-slate-200/90 bg-white/88 p-4 shadow-[0_24px_52px_-34px_rgba(15,23,42,0.75)] ui-fade-up ui-fade-up-delay backdrop-blur-xl dark:border-slate-700/80 dark:bg-slate-900/82 ${
              isScreenMaximized ? 'hidden' : ''
            }`}
          >
            <div className="rounded-2xl border border-slate-200/80 bg-gradient-to-b from-white to-slate-50 p-3 dark:border-slate-700 dark:from-slate-800 dark:to-slate-900">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Session</div>
              <div className="mt-2 text-3xl font-black tracking-widest text-slate-900 dark:text-white">{normalizedCode || '------'}</div>
              <div className="mt-2 text-xs text-slate-600 dark:text-slate-300">{joined ? 'Live and connected' : 'Not connected yet'}</div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={copySessionCode}
                  disabled={!normalizedCode}
                  className="inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                >
                  <Icon name="copy" className="h-4 w-4" /> Code
                </button>
                <button
                  type="button"
                  onClick={copyJoinLink}
                  disabled={!joinUrl}
                  className="inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                >
                  <Icon name="copy" className="h-4 w-4" /> Link
                </button>
              </div>
            </div>

            <div className="grid gap-2">
              {compactMetrics.map((item) => (
                <div key={item.label} className="rounded-xl border border-slate-200/80 bg-white px-3 py-2 shadow-[0_10px_24px_-24px_rgba(15,23,42,0.9)] dark:border-slate-700 dark:bg-slate-800/70">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      <Icon name={item.icon} className="h-4 w-4" /> {item.label}
                    </div>
                    <div className="text-xl font-semibold text-slate-900 dark:text-white">{item.value}</div>
                  </div>
                </div>
              ))}
            </div>

            {!isTeacher ? (
              <div className="pastel-surface rounded-2xl border border-sky-200/90 bg-sky-50/90 p-3 dark:border-sky-500/40 dark:bg-sky-900/20">
                <div className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-sky-700 dark:text-sky-300">AI explain the screen</div>
                {explainLoading ? <div className="text-sm text-sky-700 dark:text-sky-200">Generating explanation...</div> : null}
                {!explainLoading && screenExplanation ? (
                  <>
                    <div className="text-sm leading-relaxed text-sky-900 dark:text-sky-100">{screenExplanation}</div>
                    {screenExplanationGeneratedAt ? (
                      <div className="mt-2 text-xs text-sky-700/80 dark:text-sky-300/80">Updated: {new Date(screenExplanationGeneratedAt).toLocaleTimeString()}</div>
                    ) : null}
                  </>
                ) : null}
                {!explainLoading && !screenExplanation ? (
                  <div className="text-sm text-sky-700 dark:text-sky-200">Tap the sparkle button below the video to get a short explanation of the current screen.</div>
                ) : null}
              </div>
            ) : null}

            {isTeacher && joinUrl ? (
              <div className="rounded-2xl border border-slate-200 bg-white/95 p-3 dark:border-slate-700 dark:bg-slate-800/70">
                <div className="mb-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">Scan to join</div>
                <div className="flex justify-center">
                  <SessionQRCode value={joinUrl} size={320} className="h-40 w-40 rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-700" />
                </div>
              </div>
            ) : null}

            <div className="mt-auto rounded-2xl border border-slate-200 bg-slate-50/90 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
              <div className="font-semibold text-slate-700 dark:text-slate-100">Status</div>
              <div className="mt-1">{status}</div>
              <div className="mt-1">Client: {clientId || '-'}</div>
            </div>

            {error ? (
              <div className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-700/80 dark:bg-rose-900/30 dark:text-rose-200">
                {error}
              </div>
            ) : null}
          </aside>
        </main>

        {showSessionPanel ? (
          <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/45 p-3 backdrop-blur-sm" onClick={() => setShowSessionPanel(false)}>
            <aside
              className="h-full w-full max-w-sm overflow-y-auto rounded-3xl border border-slate-200 bg-white/95 p-5 shadow-2xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold uppercase tracking-[-0.02em] text-[#1a1a1a] dark:text-slate-100">Session settings</h2>
                <button
                  type="button"
                  onClick={() => setShowSessionPanel(false)}
                  className="grid h-8 w-8 place-items-center rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  title="Close"
                  aria-label="Close"
                >
                  <Icon name="close" className="h-4 w-4" />
                </button>
              </div>

              <label className="mb-1 block text-sm font-medium">Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="mb-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none ring-sky-200 focus:ring dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:ring-sky-500/40"
                disabled={joined}
              >
                <option value="student">Student</option>
                <option value="teacher">Teacher</option>
              </select>

              <label className="mb-1 block text-sm font-medium">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mb-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none ring-sky-200 focus:ring dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:ring-sky-500/40"
                placeholder={isTeacher ? 'Teacher name' : 'Student name'}
                disabled={joined}
              />

              <label className="mb-1 block text-sm font-medium">Session code</label>
              <div className="mb-3 flex gap-2">
                <input
                  value={sessionCode}
                  onChange={(e) => setSessionCode(e.target.value.toUpperCase())}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none ring-sky-200 focus:ring dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:ring-sky-500/40"
                  placeholder={isTeacher ? 'Auto-generated for host' : 'ABC123'}
                  disabled={joined || isTeacher}
                />
                <button
                  type="button"
                  onClick={copySessionCode}
                  disabled={!normalizedCode}
                  className="grid h-10 w-10 place-items-center rounded-lg border border-slate-300 text-lg text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  title="Copy session code"
                  aria-label="Copy session code"
                >
                  <Icon name="copy" className="h-5 w-5" />
                </button>
              </div>

              <label className="mb-1 block text-sm font-medium">Student join URL</label>
              <div className="mb-3 flex gap-2">
                <input
                  value={joinUrl}
                  readOnly
                  className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-700 shadow-sm outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  placeholder="Join URL appears when a session code is set"
                />
                <button
                  type="button"
                  onClick={copyJoinLink}
                  disabled={!joinUrl}
                  className="grid h-10 w-10 place-items-center rounded-lg border border-slate-300 text-lg text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  title="Copy student join URL"
                  aria-label="Copy student join URL"
                >
                  <Icon name="copy" className="h-5 w-5" />
                </button>
              </div>

              {isTeacher && joinUrl ? (
                <div className="mb-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/80">
                  <div className="mb-2 text-center text-sm font-semibold text-slate-700 dark:text-slate-100">Students: scan to join</div>
                  <div className="flex justify-center">
                    <SessionQRCode value={joinUrl} size={420} className="h-[300px] w-[300px] rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-700" />
                  </div>
                  <div className="mt-3 text-center text-4xl font-black tracking-widest text-slate-900 dark:text-slate-100">{normalizedCode}</div>
                </div>
              ) : null}

              {!joined ? (
                <div className="space-y-2">
                  {isTeacher ? (
                    <button
                      type="button"
                      onClick={createSession}
                      className="w-full rounded-lg bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-slate-200"
                    >
                      Create session
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={connectWebSocket}
                      className="w-full rounded-lg bg-sky-700 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-600"
                    >
                      Join session
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {isTeacher ? (
                    <button
                      type="button"
                      onClick={endSessionAndDownloadReport}
                      disabled={endingSession}
                      className="w-full rounded-lg bg-rose-700 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {endingSession ? 'Ending session...' : 'End session + download report'}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={disconnect}
                    className="w-full rounded-lg bg-rose-600 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-500"
                  >
                    Leave session
                  </button>
                </div>
              )}

              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-300">
                <div className="font-medium text-slate-700 dark:text-slate-100">Status</div>
                <div className="mt-1">{status}</div>
                <div className="mt-1">Client: {clientId || '-'}</div>
              </div>

              {error ? (
                <div className="mt-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-700/80 dark:bg-rose-900/30 dark:text-rose-200">
                  {error}
                </div>
              ) : null}
            </aside>
          </div>
        ) : null}

        {showNotesPanel ? (
          <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/45 p-3 backdrop-blur-sm" onClick={() => setShowNotesPanel(false)}>
            <aside
              className="h-full w-full max-w-md rounded-3xl border border-slate-200 bg-white/95 p-5 shadow-2xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold uppercase tracking-[-0.02em] text-[#1a1a1a] dark:text-slate-100">Shared notes</h2>
                <button
                  type="button"
                  onClick={() => setShowNotesPanel(false)}
                  className="grid h-8 w-8 place-items-center rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  title="Close"
                  aria-label="Close"
                >
                  <Icon name="close" className="h-4 w-4" />
                </button>
              </div>
              <textarea
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value)
                  if (isTeacher) send('note_update', { text: e.target.value })
                }}
                disabled={!joined || !isTeacher}
                className="h-[calc(100%-3rem)] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none ring-sky-200 focus:ring disabled:cursor-not-allowed disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:ring-sky-500/40 dark:disabled:bg-slate-900"
                placeholder={isTeacher ? 'Type and broadcast key points...' : 'Teacher notes will appear here...'}
              />
            </aside>
          </div>
        ) : null}

        {showAwardsPanel ? (
          <div className="fixed inset-0 z-40 grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm" onClick={() => setShowAwardsPanel(false)}>
            <section
              className="w-full max-w-2xl rounded-3xl border border-slate-200 bg-white/95 p-5 shadow-2xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold uppercase tracking-[-0.02em] text-[#1a1a1a] dark:text-slate-100">Class awards</h2>
                <button
                  type="button"
                  onClick={() => setShowAwardsPanel(false)}
                  className="grid h-8 w-8 place-items-center rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  title="Close"
                  aria-label="Close"
                >
                  <Icon name="close" className="h-4 w-4" />
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <StatCard label="Students" value={metrics.student_count} />
                <StatCard label="Confusion level" value={confusionMetricDisplay} />
                <StatCard label="Break votes" value={breakVotesMetricDisplay} help="Threshold: 40%" />
              </div>

              {isTeacher ? (
                <>
                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200">
                    <div>Quiz answers: {quizProgress?.total_answers ?? analytics?.quiz?.total_answers ?? 0}</div>
                    <div>Correct answers: {quizProgress?.correct_answers ?? analytics?.quiz?.correct_answers ?? 0}</div>
                    <div>Accuracy: {accuracyValue}%</div>
                  </div>

                  <div className="mt-3 space-y-2">
                    {awards.length ? (
                      awards.map((award) => (
                        <div
                          key={award.id}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800/70"
                        >
                          <div className="font-semibold text-slate-900 dark:text-slate-100">{award.title}</div>
                          <div className="text-slate-600 dark:text-slate-300">{award.description}</div>
                          <div className="mt-1 text-sky-700 dark:text-sky-300">
                            {award.winner_name ? `${award.winner_name} · ${award.value} ${award.unit}` : 'No winner yet'}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-xl border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-600 dark:border-slate-600 dark:text-slate-300">
                        No award data yet. Ask students to interact with quiz, confusion, or break actions.
                      </div>
                    )}
                  </div>

                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200">
                  <div>Quiz answers: {quizProgress?.total_answers ?? analytics?.quiz?.total_answers ?? 0}</div>
                  <div>Correct answers: {quizProgress?.correct_answers ?? analytics?.quiz?.correct_answers ?? 0}</div>
                  <div>Accuracy: {accuracyValue}%</div>
                  <div className="mt-2 border-t border-slate-200 pt-2 dark:border-slate-700">Engagement score: {analytics?.engagement?.score ?? 0}/100</div>
                  <div>Quiz participation: {Math.round(100 * (analytics?.engagement?.quiz_participation_rate ?? 0))}%</div>
                  <div>Break vote rate: {Math.round(100 * (analytics?.engagement?.break_vote_rate ?? 0))}%</div>
                  <div>Confusion per student: {(analytics?.engagement?.confusion_per_student ?? 0).toFixed(2)}</div>
                </div>
                </>
              ) : null}
            </section>
          </div>
        ) : null}

        {showQuizPromptPanel && isTeacher ? (
          <div className="fixed inset-0 z-40 grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm" onClick={() => setShowQuizPromptPanel(false)}>
            <section
              className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white/95 p-5 shadow-2xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold uppercase tracking-[-0.02em] text-[#1a1a1a] dark:text-slate-100">AI quiz prompt</h2>
                <button
                  type="button"
                  onClick={() => setShowQuizPromptPanel(false)}
                  className="grid h-8 w-8 place-items-center rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  title="Close"
                  aria-label="Close"
                >
                  <Icon name="close" className="h-4 w-4" />
                </button>
              </div>

              <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">Choose a preset style or keep default, then generate from the current shared screen.</p>

              <div className="space-y-2">
                {quizPromptPresets.map((preset) => (
                  <label
                    key={preset.id}
                    className="flex cursor-pointer gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm hover:border-sky-300 hover:bg-sky-50/40 dark:border-slate-700 dark:bg-slate-800/60 dark:hover:border-sky-500/50 dark:hover:bg-sky-900/20"
                  >
                    <input
                      type="radio"
                      name="quiz-preset"
                      value={preset.id}
                      checked={selectedQuizPreset === preset.id}
                      onChange={(event) => setSelectedQuizPreset(event.target.value)}
                      className="mt-1"
                    />
                    <span>
                      <span className="block font-medium text-slate-900 dark:text-slate-100">{preset.label}</span>
                      <span className="block text-xs text-slate-600 dark:text-slate-300">{preset.description}</span>
                    </span>
                  </label>
                ))}
              </div>

              <label className="mt-4 block text-sm font-medium text-slate-800 dark:text-slate-200">Optional extra instruction</label>
              <textarea
                value={quizCustomPrompt}
                onChange={(event) => setQuizCustomPrompt(event.target.value)}
                rows={3}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none ring-sky-200 focus:ring dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:ring-sky-500/40"
                placeholder="Example: Focus on definitions from the last 5 minutes."
              />
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">The AI is always instructed to keep option lengths similar so the correct answer is not obvious by wording or length.</p>

              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowQuizPromptPanel(false)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={quizGenerationPending}
                  onClick={generateQuizFromCurrentScreen}
                  className="rounded-lg bg-sky-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {quizGenerationPending ? 'Generating...' : 'Generate quiz'}
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default App
