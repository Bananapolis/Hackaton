import { useEffect, useMemo, useRef, useState } from 'react'
import { useGoogleLogin } from '@react-oauth/google'
import {
  AlertTriangle,
  Camera,
  CheckCircle,
  Coffee,
  Copy,
  Eye,
  EyeOff,
  FileText,
  FolderOpen,
  Hand,
  History,
  Lock,
  LockOpen,
  LogOut,
  Maximize2,
  MessageSquare,
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
import { PDFDocument } from 'pdf-lib'
import { config } from './config'
import { CountdownBanner } from './components/CountdownBanner'
import { QuizOverlay } from './components/QuizOverlay'
import { SessionQRCode } from './components/SessionQRCode'
import { StatCard } from './components/StatCard'

const rtcConfig = config.rtcConfig
const sessionPreferencesStorageKey = 'session-preferences-v1'
const authTokenStorageKey = 'auth-token-v1'
const authUserStorageKey = 'auth-user-v1'
const REJOIN_STATUS_POLL_MS = 10_000
const CONFUSION_NOTIFICATION_THRESHOLD_PERCENT = 65
const CONFUSION_NOTIFICATION_RESET_PERCENT = 45
const BREAK_NOTIFICATION_COOLDOWN_MS = 45_000
const STUDENT_REPLAY_WINDOW_MS = 60_000
const STUDENT_REPLAY_CAPTURE_INTERVAL_MS = 2_000
const STUDENT_REPLAY_MAX_WIDTH = 960
const STUDENT_REPLAY_JPEG_QUALITY = 0.62
const quizPromptPresets = [
  {
    id: 'default',
    label: 'Default',
    description: 'Balanced concept-check based on current notes.',
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

function storageGetItem(key) {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function storageSetItem(key, value) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Ignore storage errors (common in strict iOS private browsing settings).
  }
}

function storageRemoveItem(key) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(key)
  } catch {
    // Ignore storage errors (common in strict iOS private browsing settings).
  }
}

export function loadSessionPreferences() {
  if (typeof window === 'undefined') {
    return { role: 'student', name: '', sessionCode: '' }
  }

  try {
    const raw = storageGetItem(sessionPreferencesStorageKey)
    if (!raw) {
      return { role: 'student', name: '', sessionCode: '' }
    }

    const parsed = JSON.parse(raw)
    const role = parsed?.role === 'teacher' ? 'teacher' : 'student'
    const name = typeof parsed?.name === 'string' ? parsed.name : ''

    return { role, name, sessionCode: '' }
  } catch {
    return { role: 'student', name: '', sessionCode: '' }
  }
}

async function parseErrorResponse(response) {
  const text = await response.text()
  if (!text) return `Request failed with status ${response.status}`
  // If the response is HTML (e.g. from nginx), extract a readable message
  if (text.trimStart().startsWith('<')) {
    const statusMessages = {
      413: 'File is too large to upload.',
      414: 'Request URL too long.',
      431: 'Request headers too large.',
      500: 'Internal server error.',
      502: 'Bad gateway.',
      503: 'Service unavailable.',
      504: 'Gateway timeout.',
    }
    return statusMessages[response.status] || `Request failed with status ${response.status}`
  }
  // Try to extract FastAPI detail field
  try {
    const json = JSON.parse(text)
    return json.detail || text
  } catch {
    return text
  }
}

export async function postJson(path, body) {
  const response = await fetch(`${config.apiBase}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(await parseErrorResponse(response))
  }

  return response.json()
}

export async function apiRequest(path, { method = 'GET', body, token, isFormData = false } = {}) {
  const headers = {}
  if (!isFormData) {
    headers['Content-Type'] = 'application/json'
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const response = await fetch(`${config.apiBase}${path}`, {
    method,
    headers,
    body: body
      ? isFormData
        ? body
        : JSON.stringify(body)
      : undefined,
  })

  if (!response.ok) {
    throw new Error(await parseErrorResponse(response))
  }

  if (response.status === 204) {
    return null
  }
  return response.json()
}

function getFullscreenElement() {
  if (typeof document === 'undefined') return null
  return document.fullscreenElement || document.webkitFullscreenElement || null
}

function requestStageFullscreen(element) {
  if (!element) return Promise.reject(new Error('Fullscreen target unavailable'))

  const requestFullscreen = element.requestFullscreen || element.webkitRequestFullscreen
  if (typeof requestFullscreen !== 'function') {
    return Promise.reject(new Error('Fullscreen API unavailable'))
  }

  const result = requestFullscreen.call(element)
  return result instanceof Promise ? result : Promise.resolve()
}

function exitStageFullscreen() {
  if (typeof document === 'undefined') {
    return Promise.reject(new Error('Document unavailable'))
  }

  const exitFullscreen = document.exitFullscreen || document.webkitExitFullscreen
  if (typeof exitFullscreen !== 'function') {
    return Promise.reject(new Error('Fullscreen API unavailable'))
  }

  const result = exitFullscreen.call(document)
  return result instanceof Promise ? result : Promise.resolve()
}

function isLikelyIOSDevice() {
  if (typeof navigator === 'undefined') return false

  const ua = navigator.userAgent || ''
  const platform = navigator.platform || ''
  return /iPad|iPhone|iPod/i.test(ua) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function getVideoFullscreenState(videoElement) {
  if (!videoElement) return false
  return Boolean(
    videoElement.webkitDisplayingFullscreen
    || videoElement.webkitPresentationMode === 'fullscreen',
  )
}

export function Icon({ name, className = 'h-5 w-5' }) {
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
    library: FolderOpen,
    logout: LogOut,
    break: Coffee,
    confusion: Hand,
    users: Users,
    copy: Copy,
    close: X,
    alert: AlertTriangle,
    eye: Eye,
    eyeOff: EyeOff,
    lock: Lock,
    lockOpen: LockOpen,
    question: MessageSquare,
    camera: Camera,
    history: History,
    checkCircle: CheckCircle,
  }
  const IconComponent = icons[name]
  if (!IconComponent) return null

  return <IconComponent className={className} strokeWidth={1.9} aria-hidden="true" />
}

function shuffleOptions(options) {
  const items = Array.isArray(options) ? [...options] : []
  for (let idx = items.length - 1; idx > 0; idx -= 1) {
    const swapIdx = Math.floor(Math.random() * (idx + 1))
      ;[items[idx], items[swapIdx]] = [items[swapIdx], items[idx]]
  }
  return items
}

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

function GoogleLoginButton({ onSuccess, onError, disabled, className, children }) {
  const login = useGoogleLogin({ onSuccess, onError })
  return (
    <button type="button" onClick={() => login()} disabled={disabled} className={className}>
      {children}
    </button>
  )
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
  const [authToken, setAuthToken] = useState(() => storageGetItem(authTokenStorageKey) || '')
  const [authUser, setAuthUser] = useState(() => {
    try {
      const raw = storageGetItem(authUserStorageKey)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  })
  const [authMode, setAuthMode] = useState('login')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authDisplayName, setAuthDisplayName] = useState('')
  const [authPending, setAuthPending] = useState(false)
  const [rejoinLookupPending, setRejoinLookupPending] = useState(false)
  const [rejoinCandidate, setRejoinCandidate] = useState(null)
  const [showLibraryPanel, setShowLibraryPanel] = useState(false)
  const [libraryTab, setLibraryTab] = useState('sessions')
  const [librarySessionCode, setLibrarySessionCode] = useState('')
  const [librarySessions, setLibrarySessions] = useState([])
  const [libraryFiles, setLibraryFiles] = useState([])
  const [libraryQuizzes, setLibraryQuizzes] = useState([])
  const [libraryLoading, setLibraryLoading] = useState(false)
  const [uploadPending, setUploadPending] = useState(false)
  const [notesPngPendingById, setNotesPngPendingById] = useState({})
  const [showSavedQuizAttemptPanel, setShowSavedQuizAttemptPanel] = useState(false)
  const [savedQuizAttemptItem, setSavedQuizAttemptItem] = useState(null)
  const [savedQuizAttemptOptions, setSavedQuizAttemptOptions] = useState([])
  const [savedQuizAttemptChoice, setSavedQuizAttemptChoice] = useState('')
  const [savedQuizAttemptResult, setSavedQuizAttemptResult] = useState('')
  const [anonymousQuestions, setAnonymousQuestions] = useState([])
  const [pendingQuestionCount, setPendingQuestionCount] = useState(0)
  const [showQuestionsPanel, setShowQuestionsPanel] = useState(false)
  const [showAskQuestionPanel, setShowAskQuestionPanel] = useState(false)
  const [anonymousQuestionDraft, setAnonymousQuestionDraft] = useState('')
  const [anonymousQuestionSubmitting, setAnonymousQuestionSubmitting] = useState(false)
  const [showStudentReplayPanel, setShowStudentReplayPanel] = useState(false)
  const [studentReplayFrames, setStudentReplayFrames] = useState([])
  const [selectedReplayFrameIndex, setSelectedReplayFrameIndex] = useState(0)

  const [metrics, setMetrics] = useState({
    confusion_count: 0,
    confusion_level_percent: 0,
    break_votes: 0,
    student_count: 0,
  })
  const [notes, setNotes] = useState('')
  const [breakEndTime, setBreakEndTime] = useState(null)
  // Epoch when the 30-min focus period ends and the break-vote button unlocks (0 = unlocked)
  const [focusPeriodEndsAt, setFocusPeriodEndsAt] = useState(0)
  // Show a prominent alert banner on teacher's UI when the threshold is reached
  const [breakThresholdAlert, setBreakThresholdAlert] = useState(null)
  // Ticking "now" used to reactively compute focus-period countdown without extra effects
  const [nowEpoch, setNowEpoch] = useState(() => Date.now() / 1000)
  const [quiz, setQuiz] = useState(null)
  const [quizState, setQuizState] = useState({ hidden: false, cover_mode: true, voting_closed: false, answer_revealed: false, correct_option_id: null, per_option: null })
  const [quizProgress, setQuizProgress] = useState(null)
  const [analytics, setAnalytics] = useState(null)
  const [endingSession, setEndingSession] = useState(false)
  const [endSessionProgressMessage, setEndSessionProgressMessage] = useState('')
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
  const [isScreenSharing, setIsScreenSharing] = useState(false)
  const [confusionFlash, setConfusionFlash] = useState(false)

  const wsRef = useRef(null)
  const endingSessionRef = useRef(false)
  const localStreamRef = useRef(null)
  const peerConnectionsRef = useRef(new Map())
  const localVideoRef = useRef(null)
  const remoteVideoRef = useRef(null)
  const stageContainerRef = useRef(null)
  const sessionPanelBackdropPointerDownRef = useRef(false)
  const notificationPermissionRequestedRef = useRef(false)
  const confusionNotificationArmedRef = useRef(true)
  const lastBreakNotificationAtRef = useRef(0)
  const lastAnonymousQuestionPendingRef = useRef(0)
  const screenShareStopNotifiedRef = useRef(false)
  const replayCaptureCanvasRef = useRef(null)

  const isTeacher = role === 'teacher'
  const normalizedCode = sessionCode.trim().toUpperCase()
  const replayCapturePaused = showStudentReplayPanel && studentReplayFrames.length > 0
  const activeLibrarySessionCode = (librarySessionCode || normalizedCode).trim().toUpperCase()
  const activeSessionCode = joined ? normalizedCode : ''
  const themeToggleLabel = theme === 'dark' ? 'Switch to light' : 'Switch to dark'
  const joinUrl = useMemo(() => {
    if (!normalizedCode) return ''
    if (typeof window === 'undefined') return `?code=${encodeURIComponent(normalizedCode)}`

    const url = new URL(window.location.href)
    url.searchParams.set('code', normalizedCode)
    return url.toString()
  }, [normalizedCode])
  const activeJoinUrl = joined ? joinUrl : ''

  useEffect(() => {
    endingSessionRef.current = endingSession
  }, [endingSession])

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

  // Tick every second so focus-period countdown updates reactively
  useEffect(() => {
    const timer = setInterval(() => setNowEpoch(Date.now() / 1000), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (isTeacher && joined) {
      return
    }

    confusionNotificationArmedRef.current = true
    lastBreakNotificationAtRef.current = 0
  }, [isTeacher, joined])

  useEffect(() => {
    const persistedTheme = storageGetItem('ui-theme')
    if (persistedTheme === 'dark' || persistedTheme === 'light') {
      setTheme(persistedTheme)
    }
  }, [])

  useEffect(() => {
    if (!joined) {
      setShowSessionPanel(true)

      if (getFullscreenElement() === stageContainerRef.current) {
        exitStageFullscreen().catch(() => { })
      }

      setIsScreenMaximized(false)
    }
  }, [joined])

  useEffect(() => {
    if (!joined || isTeacher) {
      setShowStudentReplayPanel(false)
      setStudentReplayFrames([])
      setSelectedReplayFrameIndex(0)
    }
  }, [isTeacher, joined])

  useEffect(() => {
    const syncFullscreenState = () => {
      const fullscreenElement = getFullscreenElement()
      const activeVideo = isTeacher ? localVideoRef.current : remoteVideoRef.current
      setIsScreenMaximized(fullscreenElement === stageContainerRef.current || getVideoFullscreenState(activeVideo))
    }

    document.addEventListener('fullscreenchange', syncFullscreenState)
    document.addEventListener('webkitfullscreenchange', syncFullscreenState)

    const videos = [localVideoRef.current, remoteVideoRef.current].filter(Boolean)
    videos.forEach((videoElement) => {
      videoElement.addEventListener('webkitbeginfullscreen', syncFullscreenState)
      videoElement.addEventListener('webkitendfullscreen', syncFullscreenState)
      videoElement.addEventListener('webkitpresentationmodechanged', syncFullscreenState)
    })

    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreenState)
      document.removeEventListener('webkitfullscreenchange', syncFullscreenState)
      videos.forEach((videoElement) => {
        videoElement.removeEventListener('webkitbeginfullscreen', syncFullscreenState)
        videoElement.removeEventListener('webkitendfullscreen', syncFullscreenState)
        videoElement.removeEventListener('webkitpresentationmodechanged', syncFullscreenState)
      })
    }
  }, [isTeacher])

  useEffect(() => {
    if (!joined) return undefined

    const timer = window.setInterval(() => {
      send('request_state')
    }, 2000)

    return () => window.clearInterval(timer)
  }, [joined])

  useEffect(() => {
    if (!joined || isTeacher || replayCapturePaused) return undefined

    const captureReplayFrame = () => {
      tryCaptureReplayFrame()
    }

    captureReplayFrame()
    const timerId = window.setInterval(captureReplayFrame, STUDENT_REPLAY_CAPTURE_INTERVAL_MS)
    return () => {
      window.clearInterval(timerId)
    }
  }, [isTeacher, joined, replayCapturePaused])

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
    }
    storageSetItem(sessionPreferencesStorageKey, JSON.stringify(preferences))
  }, [role, name])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const url = new URL(window.location.href)
    if (activeSessionCode) {
      url.searchParams.set('code', activeSessionCode)
    } else {
      url.searchParams.delete('code')
    }
    window.history.replaceState({}, '', url)
  }, [activeSessionCode])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    storageSetItem('ui-theme', theme)
  }, [theme])

  useEffect(() => {
    if (typeof window === 'undefined') return

    if (authToken) {
      storageSetItem(authTokenStorageKey, authToken)
    } else {
      storageRemoveItem(authTokenStorageKey)
    }

    if (authUser) {
      storageSetItem(authUserStorageKey, JSON.stringify(authUser))
    } else {
      storageRemoveItem(authUserStorageKey)
    }
  }, [authToken, authUser])

  useEffect(() => {
    if (!authToken || joined) {
      setRejoinCandidate(null)
      return
    }
    refreshRejoinCandidate()
  }, [authToken, joined])

  useEffect(() => {
    if (!authToken || joined) return undefined

    const timer = window.setInterval(() => {
      refreshRejoinCandidate({ silent: true })
    }, REJOIN_STATUS_POLL_MS)

    return () => window.clearInterval(timer)
  }, [authToken, joined])

  // Handle OAuth redirect callback (GitHub sends ?oauth_token=... back to frontend)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const oauthToken = params.get('oauth_token')
    const oauthUserRaw = params.get('oauth_user')
    const oauthError = params.get('oauth_error')
    if (oauthError) {
      setError(`OAuth sign-in failed: ${oauthError.replace(/_/g, ' ')}`)
      window.history.replaceState({}, '', window.location.pathname)
    } else if (oauthToken && oauthUserRaw) {
      try {
        const oauthUser = JSON.parse(oauthUserRaw)
        setAuthToken(oauthToken)
        setAuthUser(oauthUser)
        setName(oauthUser.display_name || '')
        setStatus(`Signed in as ${oauthUser.display_name}`)
      } catch {
        setError('OAuth sign-in failed: could not parse user data')
      }
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

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

  useEffect(() => {
    if (!isTeacher || !joined) {
      lastAnonymousQuestionPendingRef.current = 0
      return
    }

    if (pendingQuestionCount > lastAnonymousQuestionPendingRef.current) {
      const pendingQuestions = anonymousQuestions.filter((question) => !question?.resolved)
      const newestPendingQuestion = [...pendingQuestions].sort((first, second) =>
        String(second?.created_at || '').localeCompare(String(first?.created_at || '')),
      )[0]
      const newestQuestionText = String(newestPendingQuestion?.text || '').trim()
      const questionPreview = newestQuestionText
        ? newestQuestionText.length > 180
          ? `${newestQuestionText.slice(0, 177)}...`
          : newestQuestionText
        : ''
      const plural = pendingQuestionCount === 1 ? '' : 's'
      notifyTeacher(
        'Anonymous student question waiting',
        questionPreview
          ? `${pendingQuestionCount} anonymous question${plural} waiting. Latest: ${questionPreview}`
          : `${pendingQuestionCount} anonymous question${plural} waiting for review.`,
        'teacher-anonymous-questions',
      )
    }

    lastAnonymousQuestionPendingRef.current = pendingQuestionCount
  }, [anonymousQuestions, isTeacher, joined, pendingQuestionCount])

  useEffect(() => {
    if (!isTeacher || !joined) return

    function handleKeyDown(event) {
      // Ignore shortcuts when focus is inside an input, textarea, or contentEditable
      const tag = document.activeElement?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || document.activeElement?.isContentEditable) return

      switch (event.key.toLowerCase()) {
        case 'q':
          if (!showQuizPromptPanel) setShowQuizPromptPanel(true)
          break
        case 'n':
          if (!showNotesPanel) setShowNotesPanel(true)
          break
        case 'b':
          startBreak(300)
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isTeacher, joined, showQuizPromptPanel, showNotesPanel])

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

  function handlePanelBackdropMouseDown(event) {
    sessionPanelBackdropPointerDownRef.current = event.target === event.currentTarget
  }

  function handlePanelBackdropClick(event, onClose) {
    const clickOnBackdrop = event.target === event.currentTarget
    if (clickOnBackdrop && sessionPanelBackdropPointerDownRef.current) {
      onClose()
    }
    sessionPanelBackdropPointerDownRef.current = false
  }

  async function submitAuth() {
    setError('')
    setAuthPending(true)
    try {
      const path = authMode === 'register' ? '/api/auth/register' : '/api/auth/login'
      const payload =
        authMode === 'register'
          ? {
            email: authEmail,
            display_name: authDisplayName,
            password: authPassword,
            role: 'teacher',
          }
          : {
            email: authEmail,
            password: authPassword,
          }

      const data = await apiRequest(path, {
        method: 'POST',
        body: payload,
      })
      setAuthToken(data.token)
      setAuthUser(data.user)
      setName(data.user.display_name || '')
      setStatus(`Signed in as ${data.user.display_name}`)
      setAuthPassword('')
    } catch (err) {
      setError(err.message)
    } finally {
      setAuthPending(false)
    }
  }

  async function handleGoogleSuccess(tokenResponse) {
    setError('')
    setAuthPending(true)
    try {
      const data = await apiRequest('/api/auth/oauth/google', {
        method: 'POST',
        body: { access_token: tokenResponse.access_token },
      })
      setAuthToken(data.token)
      setAuthUser(data.user)
      setName(data.user.display_name || '')
      setStatus(`Signed in as ${data.user.display_name}`)
    } catch (err) {
      setError(err.message || 'Google sign-in failed')
    } finally {
      setAuthPending(false)
    }
  }

  function signInWithGitHub() {
    window.location.href = `${config.apiBase}/api/auth/oauth/github`
  }

  function signOut() {
    disconnect()
    setAuthToken('')
    setAuthUser(null)
    setRejoinCandidate(null)
    setLibrarySessions([])
    setLibraryFiles([])
    setLibraryQuizzes([])
    setLibrarySessionCode('')
    setAnonymousQuestions([])
    setPendingQuestionCount(0)
    setStatus('Signed out')
  }

  async function refreshLibraryData(targetSessionCode = null) {
    if (!authToken) return
    setLibraryLoading(true)
    try {
      const sessionsData = await apiRequest('/api/library/sessions', { token: authToken })
      const sessionsList = Array.isArray(sessionsData?.sessions) ? sessionsData.sessions : []
      setLibrarySessions(sessionsList)

      const requestedCode =
        typeof targetSessionCode === 'string'
          ? targetSessionCode
          : targetSessionCode && typeof targetSessionCode === 'object' && 'target' in targetSessionCode
            ? ''
            : String(targetSessionCode || '')
      let codeForFiles = (requestedCode || librarySessionCode || normalizedCode || '').trim().toUpperCase()
      if (!codeForFiles && sessionsList.length > 0) {
        codeForFiles = String(sessionsList[0]?.code || '').trim().toUpperCase()
      }
      setLibrarySessionCode(codeForFiles)

      const filesPath = codeForFiles
        ? `/api/presentations?session_code=${encodeURIComponent(codeForFiles)}`
        : '/api/presentations'
      const quizzesPath = codeForFiles
        ? `/api/quizzes?session_code=${encodeURIComponent(codeForFiles)}`
        : '/api/quizzes'
      const [filesData, quizzesData] = await Promise.all([
        apiRequest(filesPath, { token: authToken }),
        apiRequest(quizzesPath, { token: authToken }),
      ])
      setLibraryFiles(Array.isArray(filesData?.presentations) ? filesData.presentations : [])
      setLibraryQuizzes(Array.isArray(quizzesData?.quizzes) ? quizzesData.quizzes : [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLibraryLoading(false)
    }
  }

  async function refreshRejoinCandidate({ silent = false } = {}) {
    if (!authToken || joined) {
      setRejoinCandidate(null)
      return
    }

    if (!silent) {
      setRejoinLookupPending(true)
    }
    try {
      const payload = await apiRequest('/api/sessions/rejoin-status', { token: authToken })
      const candidate = payload?.rejoin_available ? payload?.candidate : null

      if (!candidate?.session_code || !candidate?.role || !candidate?.name) {
        setRejoinCandidate(null)
        return
      }

      setRejoinCandidate({
        session_code: String(candidate.session_code || '').trim().toUpperCase(),
        role: String(candidate.role || '').trim().toLowerCase() === 'teacher' ? 'teacher' : 'student',
        name: String(candidate.name || '').trim(),
        seconds_since_last_activity: Number(candidate.seconds_since_last_activity ?? 0),
        seconds_until_expiry: Number(candidate.seconds_until_expiry ?? 0),
      })
    } catch {
      if (!silent) {
        setRejoinCandidate(null)
      }
    } finally {
      if (!silent) {
        setRejoinLookupPending(false)
      }
    }
  }

  async function openLibraryPanel() {
    setShowLibraryPanel(true)
    await refreshLibraryData(activeLibrarySessionCode)
  }

  async function useLibrarySession(code) {
    const picked = (code || '').trim().toUpperCase()
    if (!picked) return
    setLibrarySessionCode(picked)
    setLibraryTab('files')
    await refreshLibraryData(picked)
  }

  async function onUploadPresentation(event) {
    const file = event.target.files?.[0]
    if (!file || !authToken) return
    if (!isTeacher) return
    if (!normalizedCode) {
      setError('Set or join a session code before uploading files.')
      event.target.value = ''
      return
    }

    setUploadPending(true)
    setError('')
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('session_code', normalizedCode)
      await apiRequest('/api/presentations', {
        method: 'POST',
        body: formData,
        token: authToken,
        isFormData: true,
      })
      setStatus(`Uploaded ${file.name}`)
      await refreshLibraryData()
    } catch (err) {
      setError(err.message)
    } finally {
      setUploadPending(false)
      event.target.value = ''
    }
  }


  function openSavedQuizAttempt(quizItem) {
    if (!quizItem) return
    setSavedQuizAttemptItem(quizItem)
    setSavedQuizAttemptOptions(shuffleOptions(quizItem.options))
    setSavedQuizAttemptChoice('')
    setSavedQuizAttemptResult('')
    setShowSavedQuizAttemptPanel(true)
  }

  function submitSavedQuizAttempt(optionId) {
    if (!savedQuizAttemptItem || savedQuizAttemptChoice) return
    const picked = String(optionId || '').toUpperCase()
    if (!picked) return
    setSavedQuizAttemptChoice(picked)

    if (!savedQuizAttemptItem.answer_revealed || !savedQuizAttemptItem.correct_option_id) {
      setSavedQuizAttemptResult('hidden')
      return
    }

    const isCorrect = picked === String(savedQuizAttemptItem.correct_option_id).toUpperCase()
    setSavedQuizAttemptResult(isCorrect ? 'correct' : 'incorrect')
  }

  function retrySavedQuizAttempt() {
    if (!savedQuizAttemptItem) return
    setSavedQuizAttemptOptions(shuffleOptions(savedQuizAttemptItem.options))
    setSavedQuizAttemptChoice('')
    setSavedQuizAttemptResult('')
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
      const data = await apiRequest('/api/sessions', {
        method: 'POST',
        token: authToken,
        body: { teacher_name: teacherName },
      })
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
    if (authToken) {
      params.set('token', authToken)
    }
    const wsUrl = `${config.wsBase}/ws/${normalizedSessionCode}?${params.toString()}`

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      setJoined(true)
      setStatus('Connected to live session')
    }

    ws.onclose = () => {
      setJoined(false)
      if (endingSessionRef.current && isTeacher) {
        setStatus('Session ended. Generating analytics report...')
      } else {
        setStatus('Disconnected')
      }
      setExplainLoading(false)
      setQuizGenerationPending(false)
      setAnonymousQuestionSubmitting(false)
      cleanupLocalScreenShare()
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
          message.payload.quiz_state || { hidden: false, cover_mode: true, voting_closed: false, answer_revealed: false, correct_option_id: null, per_option: null },
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
        setQuizState(nextState.quiz_state || { hidden: false, cover_mode: true, voting_closed: false, answer_revealed: false, correct_option_id: null, per_option: null })
        if (nextState.break_active_until) {
          setBreakEndTime(nextState.break_active_until)
        } else {
          setBreakEndTime(null)
        }
        if (nextState.focus_period_ends_at !== undefined) {
          setFocusPeriodEndsAt(nextState.focus_period_ends_at || 0)
        }
      }

      if (message.type === 'metrics') {
        setMetrics(message.payload)
      }

      if (message.type === 'break_started') {
        setBreakEndTime(message.payload.end_time_epoch)
        if (message.payload.focus_period_ends_at !== undefined) {
          setFocusPeriodEndsAt(message.payload.focus_period_ends_at || 0)
        }
        setStatus('Break timer updated')
      }

      if (message.type === 'break_ended') {
        setBreakEndTime(null)
        setStatus('Break ended')
      }

      if (message.type === 'focus_timer_reset') {
        setFocusPeriodEndsAt(message.payload?.focus_period_ends_at || 0)
        setBreakThresholdAlert(null)
      }

      if (message.type === 'notes') {
        setNotes(message.payload.text || '')
      }

      if (message.type === 'quiz') {
        setQuiz(message.payload)
        setQuizState({ hidden: false, cover_mode: true, voting_closed: false, answer_revealed: false, correct_option_id: null, per_option: null })
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
        setAnonymousQuestionSubmitting(false)
        setError(message.payload?.message || 'Unknown session error')
      }

      if (message.type === 'screen_explanation') {
        setExplainLoading(false)
        setScreenExplanation(message.payload?.text || '')
        setScreenExplanationGeneratedAt(message.payload?.generated_at || '')
        setStatus('AI explanation ready')
      }

      if (message.type === 'anonymous_questions') {
        const questions = Array.isArray(message.payload?.questions) ? message.payload.questions : []
        const pending = Number(message.payload?.pending_count ?? 0)
        setAnonymousQuestions(questions)
        setPendingQuestionCount(Number.isFinite(pending) ? Math.max(0, pending) : 0)
      }

      if (message.type === 'anonymous_question_submitted') {
        setAnonymousQuestionSubmitting(false)
        setAnonymousQuestionDraft('')
        setShowAskQuestionPanel(false)
        setStatus('Anonymous question sent to host')
      }

      if (message.type === 'break_threshold_reached') {
        const ratioPercent = Math.round((message.payload?.ratio || 0) * 100)
        const votes = message.payload?.votes ?? 0
        setStatus(`Break threshold reached (${ratioPercent}%)`)
        setBreakThresholdAlert({ ratioPercent, votes })
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

      if (message.type === 'screen_share_stopped') {
        if (!isTeacher && remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = null
        }
        setStatus('Screen sharing stopped by host')
      }
    }
  }

  function submitQuizAnswer(optionId) {
    if (!joined || isTeacher || selectedQuizOptionId || quizState.voting_closed) return
    setSelectedQuizOptionId(optionId)
    send('quiz_answer', { option_id: optionId })
    setStatus(`Quiz answer submitted: ${optionId}`)
  }

  function generateQuizFromCurrentScreen() {
    if (!joined || !isTeacher) return
    const customPrompt = quizCustomPrompt.trim()
    setQuizGenerationPending(true)
    setShowQuizPromptPanel(false)
    setStatus('Generating quiz from notes…')
    send('generate_quiz', {
      notes,
      quiz_preset: selectedQuizPreset,
      quiz_custom_prompt: customPrompt,
    })
  }

  function explainCurrentScreen() {
    if (!joined || isTeacher || explainLoading) return

    setError('')
    setExplainLoading(true)
    setStatus('Generating AI explanation...')
    send('explain_screen', {
      notes,
    })
  }

  function submitAnonymousQuestion() {
    if (!joined || isTeacher || anonymousQuestionSubmitting) return
    const text = anonymousQuestionDraft.trim()
    if (!text) {
      setError('Question cannot be empty')
      return
    }

    setError('')
    setAnonymousQuestionSubmitting(true)
    send('ask_question', { text })
  }

  function markQuestionResolved(questionId) {
    if (!joined || !isTeacher) return
    send('resolve_question', { question_id: questionId })
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

  function notifyScreenShareStoppedOnce() {
    if (screenShareStopNotifiedRef.current) return
    send('screen_share_stopped')
    screenShareStopNotifiedRef.current = true
  }

  function cleanupLocalScreenShare() {
    const stream = localStreamRef.current
    if (stream) {
      for (const track of stream.getTracks()) {
        track.onended = null
        if (track.readyState !== 'ended') {
          track.stop()
        }
      }
    }
    localStreamRef.current = null

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null
    }

    setIsScreenSharing(false)
  }

  function stopShare() {
    if (!isTeacher) return
    notifyScreenShareStoppedOnce()
    cleanupLocalScreenShare()
    setStatus('Screen sharing stopped')
  }

  async function startShare() {
    if (!isTeacher) return

    // Screen sharing requires Secure Context (HTTPS or localhost) and a supporting browser
    if (!navigator.mediaDevices?.getDisplayMedia) {
      const isSecure = window.isSecureContext
      const msg = isSecure
        ? 'Screen sharing not supported by this browser.'
        : 'Screen sharing blocked by browser security. Please reload using HTTPS or Localhost.'
      setError(msg)
      return
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      })
      localStreamRef.current = stream
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream
      }
      screenShareStopNotifiedRef.current = false
      setIsScreenSharing(true)
      setStatus('Screen sharing started')

      for (const track of stream.getTracks()) {
        track.onended = () => {
          notifyScreenShareStoppedOnce()
          cleanupLocalScreenShare()
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
    } catch (err) {
      console.error('[StartShare] Error:', err)
      setError('Screen share failed: ' + (err.message || 'Check permissions'))
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

      // 1. Process any candidates that arrived early and were queued
      if (pc.candidateQueue) {
        for (const queuedCandidate of pc.candidateQueue) {
          await pc.addIceCandidate(queuedCandidate).catch(console.error)
        }
        pc.candidateQueue = []
      }

      if (description.type === 'offer') {
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        send('signal', { target_id: fromId, description: answer })
      }
    }

    if (payload.candidate) {
      try {
        const candidate = new RTCIceCandidate(payload.candidate)
        // 2. If remoteDescription is set, add normally. Otherwise, queue it!
        if (pc.remoteDescription) {
          await pc.addIceCandidate(candidate)
        } else {
          pc.candidateQueue = pc.candidateQueue || []
          pc.candidateQueue.push(candidate)
        }
      } catch (err) {
        console.error('Failed to add ICE candidate', err)
      }
    }
  }
  function disconnect() {
    wsRef.current?.close()
    setJoined(false)
    setExplainLoading(false)
    setSessionCode('')
    cleanupLocalScreenShare()
    setAnonymousQuestions([])
    setPendingQuestionCount(0)
    setShowQuestionsPanel(false)
    setShowAskQuestionPanel(false)
    setAnonymousQuestionSubmitting(false)
  }

  function rejoinLastSession() {
    if (!rejoinCandidate) return

    const nextRole = rejoinCandidate.role === 'teacher' ? 'teacher' : 'student'
    const nextName = String(rejoinCandidate.name || '').trim()
    const nextSessionCode = String(rejoinCandidate.session_code || '').trim().toUpperCase()

    if (!nextName || !nextSessionCode) return

    setRole(nextRole)
    setName(nextName)
    setSessionCode(nextSessionCode)
    setStatus(`Rejoining session ${nextSessionCode}...`)
    connectWebSocket({
      nextRole,
      nextName,
      nextSessionCode,
    })
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

  async function downloadPdfReport(sessionCodeForFile) {
    const response = await fetch(
      `${config.apiBase}/api/sessions/${encodeURIComponent(sessionCodeForFile)}/report.pdf`
    )

    if (!response.ok) {
      const message = await response.text()
      throw new Error(message || 'Failed to download PDF report')
    }

    const reportBlob = await response.blob()
    const blobUrl = URL.createObjectURL(reportBlob)
    const link = document.createElement('a')
    const contentDisposition = response.headers.get('Content-Disposition') || ''
    const fileNameMatch = contentDisposition.match(/filename="?([^";]+)"?/i)
    link.href = blobUrl
    link.download = fileNameMatch?.[1] || `session-${sessionCodeForFile}-analytics-report.pdf`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(blobUrl)
  }

  async function endSessionAndDownloadReport() {
    if (!isTeacher || !joined || !normalizedCode || endingSession) return
    setError('')
    setEndingSession(true)
    setEndSessionProgressMessage('Ending meeting for all participants...')
    setStatus('Ending session...')

    try {
      const report = await postJson(`/api/sessions/${encodeURIComponent(normalizedCode)}/end`, {})
      setAnalytics(report.analytics || null)

      setEndSessionProgressMessage('Generating and downloading analytics PDF...')
      setStatus('Generating analytics report...')
      await downloadPdfReport(normalizedCode)

      setEndSessionProgressMessage('')
      setStatus('Session ended. Full analytics PDF report downloaded.')
      setShowAwardsPanel(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setEndingSession(false)
      setEndSessionProgressMessage('')
    }
  }

  async function toggleStageFullscreen() {
    const container = stageContainerRef.current
    if (!container) return

    try {
      const activeVideo = isTeacher ? localVideoRef.current : remoteVideoRef.current
      const enterVideoFullscreen =
        activeVideo?.requestFullscreen
        || activeVideo?.webkitRequestFullscreen
        || activeVideo?.webkitEnterFullscreen
        || activeVideo?.webkitEnterFullScreen
      const exitVideoFullscreen =
        activeVideo?.webkitExitFullscreen
        || activeVideo?.webkitExitFullScreen

      const canUseIOSVideoFullscreen = isLikelyIOSDevice() && activeVideo && typeof enterVideoFullscreen === 'function'

      if (canUseIOSVideoFullscreen) {
        if (getVideoFullscreenState(activeVideo)) {
          if (typeof exitVideoFullscreen === 'function') {
            exitVideoFullscreen.call(activeVideo)
          } else {
            await exitStageFullscreen()
          }
          setIsScreenMaximized(false)
        } else {
          await activeVideo.play().catch(() => { })
          const result = enterVideoFullscreen.call(activeVideo)
          if (result instanceof Promise) {
            await result
          }
          setIsScreenMaximized(true)
        }
        return
      }

      if (getFullscreenElement() === container) {
        await exitStageFullscreen()
      } else if (!getFullscreenElement()) {
        await requestStageFullscreen(container)
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

  async function captureLiveScreenAsPdf() {
    if (isTeacher || !joined) return

    try {
      setError('')
      setStatus('Capturing screenshot from live screen...')

      const videoElement = remoteVideoRef.current
      const hasVideoFrame = Boolean(
        videoElement
        && videoElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        && videoElement.videoWidth > 0
        && videoElement.videoHeight > 0
      )

      const canvas = document.createElement('canvas')
      canvas.width = hasVideoFrame ? videoElement.videoWidth : 1280
      canvas.height = hasVideoFrame ? videoElement.videoHeight : 720
      const context = canvas.getContext('2d')
      if (!context) {
        throw new Error('Canvas context unavailable')
      }

      if (hasVideoFrame) {
        context.drawImage(videoElement, 0, 0, canvas.width, canvas.height)
      } else {
        context.fillStyle = '#000000'
        context.fillRect(0, 0, canvas.width, canvas.height)
      }

      const pngBlob = await new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob)
            return
          }
          reject(new Error('Canvas blob generation failed'))
        }, 'image/png')
      })
      const imageBytes = await pngBlob.arrayBuffer()

      const pdfDoc = await PDFDocument.create()
      const screenshotImage = await pdfDoc.embedPng(imageBytes)

      const isLandscape = screenshotImage.width >= screenshotImage.height
      const pageWidth = isLandscape ? 842 : 595
      const pageHeight = isLandscape ? 595 : 842
      const scale = Math.min(pageWidth / screenshotImage.width, pageHeight / screenshotImage.height)
      const drawWidth = screenshotImage.width * scale
      const drawHeight = screenshotImage.height * scale
      const offsetX = (pageWidth - drawWidth) / 2
      const offsetY = (pageHeight - drawHeight) / 2

      const page = pdfDoc.addPage([pageWidth, pageHeight])
      page.drawImage(screenshotImage, {
        x: offsetX,
        y: offsetY,
        width: drawWidth,
        height: drawHeight,
      })

      const pdfBytes = await pdfDoc.save()
      const blob = new Blob([pdfBytes], { type: 'application/pdf' })
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      link.href = objectUrl
      link.download = `live-screen-${normalizedCode || 'session'}-${timestamp}.pdf`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(objectUrl)

      setStatus(hasVideoFrame ? 'Live screen screenshot downloaded as PDF.' : 'Blank screenshot PDF downloaded.')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown capture error'
      setError(`Could not capture screenshot as PDF. ${message}`)
    }
  }

  function tryCaptureReplayFrame() {
    const videoElement = remoteVideoRef.current
    if (
      !videoElement
      || videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
      || videoElement.videoWidth <= 0
      || videoElement.videoHeight <= 0
    ) {
      return false
    }

    try {
      const scale = Math.min(1, STUDENT_REPLAY_MAX_WIDTH / videoElement.videoWidth)
      const targetWidth = Math.max(1, Math.round(videoElement.videoWidth * scale))
      const targetHeight = Math.max(1, Math.round(videoElement.videoHeight * scale))

      let canvas = replayCaptureCanvasRef.current
      if (!canvas) {
        canvas = document.createElement('canvas')
        replayCaptureCanvasRef.current = canvas
      }

      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth
        canvas.height = targetHeight
      }

      const context = canvas.getContext('2d', { willReadFrequently: false })
      if (!context) return false

      context.drawImage(videoElement, 0, 0, targetWidth, targetHeight)

      const frameDataUrl = canvas.toDataURL('image/jpeg', STUDENT_REPLAY_JPEG_QUALITY)
      const capturedAt = Date.now()

      setStudentReplayFrames((currentFrames) => {
        const cutoff = capturedAt - STUDENT_REPLAY_WINDOW_MS
        const recentFrames = currentFrames.filter((frame) => frame.capturedAt >= cutoff)
        return [
          ...recentFrames,
          {
            id: `${capturedAt}-${recentFrames.length}`,
            capturedAt,
            dataUrl: frameDataUrl,
          },
        ]
      })

      return true
    } catch {
      return false
    }
  }

  function openStudentReplayPanel() {
    if (isTeacher || !joined) return
    const capturedNow = tryCaptureReplayFrame()

    setError('')
    setSelectedReplayFrameIndex(Math.max(0, studentReplayFrames.length - 1))
    setShowStudentReplayPanel(true)
    if (studentReplayFrames.length || capturedNow) {
      setStatus('Replay paused for your device. Browse the last minute of frames.')
    } else {
      setStatus('Opening replay. Waiting for the first live frame...')
    }
  }

  function closeStudentReplayPanel() {
    setShowStudentReplayPanel(false)
    setStatus('Replay closed. Live frame buffer resumed.')
  }

  async function downloadPresentation(item) {
    if (!authToken) return
    try {
      const downloadSuffix =
        !isTeacher && activeLibrarySessionCode
          ? `${item.download_url}?session_code=${encodeURIComponent(activeLibrarySessionCode)}`
          : item.download_url
      const response = await fetch(`${config.apiBase}${downloadSuffix}`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      })

      if (!response.ok) {
        throw new Error(await parseErrorResponse(response))
      }

      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = item.original_name || 'presentation'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(objectUrl)
    } catch (err) {
      setError(err.message)
    }
  }

  async function generatePresentationNotesPng(item) {
    if (!authToken) return
    setNotesPngPendingById((current) => ({ ...current, [item.id]: true }))
    try {
      const notesSuffixBase = `/api/presentations/${item.id}/notes-png`
      const notesSuffix = !isTeacher && activeLibrarySessionCode
        ? `${notesSuffixBase}?session_code=${encodeURIComponent(activeLibrarySessionCode)}`
        : notesSuffixBase

      const response = await fetch(`${config.apiBase}${notesSuffix}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      })

      if (!response.ok) {
        throw new Error(await parseErrorResponse(response))
      }

      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      const fallbackStem = (item.original_name || 'presentation').replace(/\.[^.]+$/, '')
      link.download = `${fallbackStem}-student-notes.png`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(objectUrl)
      setStatus(`Generated notes PNG for ${item.original_name}`)
    } catch (err) {
      setError(err.message)
    } finally {
      setNotesPngPendingById((current) => {
        const copy = { ...current }
        delete copy[item.id]
        return copy
      })
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
  const breakIsActive = Boolean(breakEndTime && breakEndTime > nowEpoch)
  // Seconds left until the break-vote button unlocks (0 means already unlocked)
  const focusSecondsLeft = focusPeriodEndsAt > 0 ? Math.max(0, Math.floor(focusPeriodEndsAt - nowEpoch)) : 0
  // Button is active when: joined, no break in progress, and focus period has elapsed
  const breakVoteButtonActive = joined && !breakIsActive && focusSecondsLeft === 0
  const focusCountdownLabel =
    focusSecondsLeft > 0
      ? `Break available in ${Math.floor(focusSecondsLeft / 60)}:${String(focusSecondsLeft % 60).padStart(2, '0')}`
      : null
  const compactMetrics = [
    { label: 'Students', value: metrics.student_count, icon: 'users' },
    { label: 'Confusion level', value: confusionMetricDisplay, icon: 'alert' },
    { label: 'Break votes', value: breakVotesMetricDisplay, icon: 'break' },
  ]
  const roleLabel = isTeacher ? 'Host mode' : 'Join mode'
  const quizVisible = Boolean(quiz) && !quizState.hidden
  const quizReadonly = isTeacher || quizState.voting_closed
  const hasRejoinCandidate = Boolean(rejoinCandidate?.session_code && rejoinCandidate?.name)

  if (!authToken || !authUser) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-100 via-sky-50 to-emerald-50 p-4 text-slate-900 dark:from-slate-950 dark:via-slate-900 dark:to-slate-900 dark:text-slate-100">
        <div className="mx-auto mt-10 w-full max-w-lg rounded-3xl border border-slate-200/90 bg-white/90 p-6 shadow-2xl backdrop-blur dark:border-slate-700/80 dark:bg-slate-900/88">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Classroom platform</div>
          <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-900 dark:text-slate-100">Register or sign in</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Use your account to access sessions, uploaded files, and saved quizzes.</p>

          <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setAuthMode('login')}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition ${authMode === 'login' ? 'bg-white text-slate-900 shadow dark:bg-slate-700 dark:text-slate-100' : 'text-slate-600 dark:text-slate-300'}`}
            >
              Login
            </button>
            <button
              type="button"
              onClick={() => setAuthMode('register')}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition ${authMode === 'register' ? 'bg-white text-slate-900 shadow dark:bg-slate-700 dark:text-slate-100' : 'text-slate-600 dark:text-slate-300'}`}
            >
              Register
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {authMode === 'register' ? (
              <>
                <input
                  value={authDisplayName}
                  onChange={(event) => setAuthDisplayName(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-sky-200 focus:ring dark:border-slate-700 dark:bg-slate-800 dark:ring-sky-500/40"
                  placeholder="Display name"
                />
              </>
            ) : null}
            <input
              value={authEmail}
              onChange={(event) => setAuthEmail(event.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-sky-200 focus:ring dark:border-slate-700 dark:bg-slate-800 dark:ring-sky-500/40"
              placeholder="Email"
              type="email"
            />
            <input
              value={authPassword}
              onChange={(event) => setAuthPassword(event.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-sky-200 focus:ring dark:border-slate-700 dark:bg-slate-800 dark:ring-sky-500/40"
              placeholder="Password"
              type="password"
            />
            <button
              type="button"
              onClick={submitAuth}
              disabled={authPending}
              className="w-full rounded-lg bg-sky-700 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {authPending ? 'Please wait...' : authMode === 'register' ? 'Create account' : 'Login'}
            </button>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
            <span className="text-xs text-slate-400 dark:text-slate-500">or continue with</span>
            <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            {GOOGLE_CLIENT_ID ? (
              <GoogleLoginButton
                onSuccess={handleGoogleSuccess}
                onError={() => setError('Google sign-in was cancelled or failed')}
                disabled={authPending}
                className="flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Google
              </GoogleLoginButton>
            ) : null}
            <button
              type="button"
              onClick={signInWithGitHub}
              disabled={authPending}
              className="flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
                <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
              </svg>
              GitHub
            </button>
          </div>

          {error ? <div className="mt-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-700/80 dark:bg-rose-900/30 dark:text-rose-200">{error}</div> : null}
        </div>
        <div className="mt-4 text-center font-mono text-[10px] text-slate-400 dark:text-slate-600">{__APP_VERSION__}</div>
      </div>
    )
  }
  const stageControlsVisibilityClass = isScreenMaximized
    ? 'sm:opacity-0 sm:pointer-events-none sm:transition-opacity sm:duration-200 sm:group-hover/stage:opacity-100 sm:group-hover/stage:pointer-events-auto sm:group-focus-within/stage:opacity-100 sm:group-focus-within/stage:pointer-events-auto'
    : ''

  return (
    <div className="app-shell min-h-screen text-slate-900 transition-colors dark:text-slate-100">
      <div className="mx-auto flex min-h-screen w-full max-w-[1920px] flex-col px-3 py-3 lg:px-6 lg:py-5">
        <header className="app-header mb-4 flex flex-wrap items-center justify-between gap-3 ui-fade-up">
          <div className="rounded-2xl border border-slate-200/80 bg-white/85 px-4 py-2.5 shadow-[0_18px_35px_-24px_rgba(15,23,42,0.65)] backdrop-blur-xl dark:border-slate-700/80 dark:bg-slate-900/75">
            <div className="hero-subtext text-[11px] uppercase tracking-[0.08em]">VIA Live</div>
            <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              {roleLabel}
            </div>
            <div className="mt-0.5 font-mono text-[9px] text-slate-400 dark:text-slate-600">{__APP_VERSION__}</div>
          </div>
          <div className="mobile-topbar-scroll flex w-full items-center gap-1.5 overflow-x-auto rounded-2xl border border-slate-200/90 bg-white/90 p-1.5 shadow-[0_16px_32px_-24px_rgba(15,23,42,0.9)] backdrop-blur-xl sm:w-auto dark:border-slate-700 dark:bg-slate-900/75">
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
                onClick={() => setShowQuestionsPanel(true)}
                className="relative grid h-9 w-9 place-items-center rounded-xl border border-transparent text-slate-700 transition hover:border-slate-200 hover:bg-white dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800"
                title="Anonymous questions"
                aria-label="Anonymous questions"
              >
                <Icon name="question" className="h-5 w-5" />
                {pendingQuestionCount > 0 ? (
                  <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-rose-600 px-1 text-center text-[10px] font-bold text-white">
                    {pendingQuestionCount > 9 ? '9+' : pendingQuestionCount}
                  </span>
                ) : null}
              </button>
            ) : null}
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
              onClick={openLibraryPanel}
              className="grid h-9 w-9 place-items-center rounded-xl border border-transparent text-slate-700 transition hover:border-slate-200 hover:bg-white dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800"
              title="Sessions / files / quizzes"
              aria-label="Sessions / files / quizzes"
            >
              <Icon name="library" className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
              className="grid h-9 w-9 place-items-center rounded-xl border border-transparent text-slate-700 transition hover:border-slate-200 hover:bg-white dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800"
              aria-label={themeToggleLabel}
              title={themeToggleLabel}
            >
              {theme === 'dark' ? <Icon name="sun" className="h-5 w-5" /> : <Icon name="moon" className="h-5 w-5" />}
            </button>
            <button
              type="button"
              onClick={signOut}
              className="grid h-9 w-9 place-items-center rounded-xl border border-transparent text-slate-700 transition hover:border-slate-200 hover:bg-white dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800"
              title="Sign out"
              aria-label="Sign out"
            >
              <Icon name="logout" className="h-5 w-5" />
            </button>
          </div>
        </header>

        <CountdownBanner endTimeEpoch={breakEndTime} />

        {isTeacher && breakThresholdAlert && !breakIsActive && (
          <div className="mb-4 flex items-center justify-between rounded-2xl border border-amber-300/70 bg-amber-50 px-4 py-2.5 text-amber-900 shadow-sm dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200">
            <div className="flex items-center gap-2">
              <Coffee className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span className="text-sm font-semibold">
                Students want a break — {breakThresholdAlert.ratioPercent}% voted ({breakThresholdAlert.votes} student{breakThresholdAlert.votes !== 1 ? 's' : ''})
              </span>
            </div>
            <button
              type="button"
              onClick={() => setBreakThresholdAlert(null)}
              className="ml-4 shrink-0 rounded-lg p-1 text-amber-700 transition hover:bg-amber-200 dark:text-amber-400 dark:hover:bg-amber-900/50"
              aria-label="Dismiss alert"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <main className="app-main grid min-h-0 flex-1 gap-4 ui-fade-up lg:grid-cols-[minmax(0,1fr)_340px]">
          <section
            ref={stageContainerRef}
            className={`app-stage group/stage relative overflow-hidden border border-slate-300/65 bg-slate-950 shadow-[0_32px_70px_-40px_rgba(2,6,23,0.95)] ui-fade-up dark:border-slate-700/60 ${isScreenMaximized
                ? 'min-h-screen rounded-none border-0'
                : 'min-h-[60vh] rounded-[28px]'
              }`}
          >
            <div className="absolute left-4 top-4 z-20 flex flex-wrap items-center gap-2">
              <div className="rounded-full border border-white/20 bg-slate-950/75 px-3 py-1 text-xs font-medium text-slate-100 backdrop-blur" title={status}>
                {shortStatus}
              </div>
              <div className="rounded-full border border-sky-300/35 bg-sky-500/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-sky-100" title="Session code">
                {activeSessionCode || 'No active code'}
              </div>
              <div className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs text-slate-200">{roleLabel}</div>
            </div>

            <div className="absolute right-3 top-14 z-20 flex gap-1.5 sm:right-4 sm:top-4">
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
                    answerRevealed={quizState.answer_revealed}
                    correctOptionId={quizState.correct_option_id}
                    perOption={quizState.per_option}
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
                      disabled={!joined || quizState.answer_revealed}
                      onClick={() => send('quiz_control', { answer_revealed: true })}
                      className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-600 text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                      title={quizState.answer_revealed ? 'Answer revealed' : 'Reveal correct answer'}
                      aria-label={quizState.answer_revealed ? 'Answer revealed' : 'Reveal correct answer'}
                    >
                      <Icon name="checkCircle" className="h-5 w-5" />
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

              <div
                className={`mobile-stage-controls-wrap absolute left-1/2 z-20 -translate-x-1/2 ${stageControlsVisibilityClass}`}
                style={{ bottom: 'max(1rem, env(safe-area-inset-bottom))' }}
              >
                <div className="mobile-stage-controls flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/90 p-2 shadow-2xl backdrop-blur-2xl dark:border-slate-700/80 dark:bg-slate-900/88">
                  {isTeacher ? (
                    <>
                      <button
                        type="button"
                        disabled={!joined}
                        onClick={() => (isScreenSharing ? stopShare() : startShare())}
                        className={`grid h-11 w-11 place-items-center rounded-xl text-lg text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${isScreenSharing ? 'bg-rose-600 hover:bg-rose-500' : 'bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-slate-200'}`}
                        title={isScreenSharing ? 'Stop screen share' : 'Start screen share'}
                        aria-label={isScreenSharing ? 'Stop screen share' : 'Start screen share'}
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
                          setConfusionFlash(true)
                          setTimeout(() => setConfusionFlash(false), 1500)
                        }}
                        className={`grid h-11 w-11 place-items-center rounded-xl text-lg text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${confusionFlash ? 'bg-amber-500 ring-2 ring-amber-300/70 ring-offset-1 ring-offset-slate-900' : 'bg-slate-800 hover:bg-slate-700'}`}
                        title="Signal Confusion to Teacher"
                        aria-label="Signal Confusion to Teacher"
                      >
                        <Icon name="confusion" className="h-5 w-5" />
                      </button>
                      <div className="flex flex-col items-center gap-0.5">
                        <button
                          type="button"
                          disabled={!breakVoteButtonActive}
                          onClick={() => {
                            send('break_vote')
                            setStatus('Break vote sent')
                          }}
                          className={`grid h-11 w-11 place-items-center rounded-xl text-lg text-white transition disabled:cursor-not-allowed disabled:opacity-40 ${breakVoteButtonActive ? 'bg-sky-700 hover:bg-sky-600' : 'bg-slate-600'}`}
                          title={focusCountdownLabel ?? (breakIsActive ? 'Break in progress' : 'Request break')}
                          aria-label="Request break"
                        >
                          <Icon name="break" className="h-5 w-5" />
                        </button>
                        {focusCountdownLabel && (
                          <span className="text-[9px] font-medium tabular-nums text-slate-400 dark:text-slate-500">
                            {Math.floor(focusSecondsLeft / 60)}:{String(focusSecondsLeft % 60).padStart(2, '0')}
                          </span>
                        )}
                      </div>
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
                        onClick={() => {
                          setError('')
                          setShowAskQuestionPanel(true)
                        }}
                        className="grid h-11 w-11 place-items-center rounded-xl bg-amber-600 text-lg text-white transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
                        title="Ask anonymous question"
                        aria-label="Ask anonymous question"
                      >
                        <Icon name="question" className="h-5 w-5" />
                      </button>
                      <button
                        type="button"
                        disabled={!joined}
                        onClick={captureLiveScreenAsPdf}
                        className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-700 text-lg text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
                        title="Take screenshot (PDF)"
                        aria-label="Take screenshot (PDF)"
                      >
                        <Icon name="camera" className="h-5 w-5" />
                      </button>
                      <button
                        type="button"
                        disabled={!joined}
                        onClick={openStudentReplayPanel}
                        className="grid h-11 w-11 place-items-center rounded-xl bg-violet-700 text-lg text-white transition hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-50"
                        title="View last minute"
                        aria-label="View last minute"
                      >
                        <Icon name="history" className="h-5 w-5" />
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
            className={`app-aside flex flex-col gap-3 rounded-[28px] border border-slate-200/90 bg-white/88 p-4 shadow-[0_24px_52px_-34px_rgba(15,23,42,0.75)] ui-fade-up ui-fade-up-delay backdrop-blur-xl dark:border-slate-700/80 dark:bg-slate-900/82 ${isScreenMaximized ? 'hidden' : ''
              }`}
          >
            <div className="rounded-2xl border border-slate-200/80 bg-gradient-to-b from-white to-slate-50 p-3 dark:border-slate-700 dark:from-slate-800 dark:to-slate-900">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Session</div>
              <div className="mt-2 text-3xl font-black tracking-widest text-slate-900 dark:text-white">{activeSessionCode || '------'}</div>
              <div className="mt-2 text-xs text-slate-600 dark:text-slate-300">{joined ? 'Live and connected' : 'Not connected yet'}</div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={copySessionCode}
                  disabled={!activeSessionCode}
                  className="inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                >
                  <Icon name="copy" className="h-4 w-4" /> Code
                </button>
                <button
                  type="button"
                  onClick={copyJoinLink}
                  disabled={!activeJoinUrl}
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

            {isTeacher ? (
              <div className="rounded-2xl border border-amber-200/90 bg-amber-50/90 p-3 dark:border-amber-500/40 dark:bg-amber-900/20">
                <div className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-amber-700 dark:text-amber-300">Anonymous questions</div>
                <div className="text-sm text-amber-900 dark:text-amber-100">
                  {pendingQuestionCount > 0
                    ? `${pendingQuestionCount} waiting for your review.`
                    : 'No pending anonymous questions.'}
                </div>
                <button
                  type="button"
                  onClick={() => setShowQuestionsPanel(true)}
                  className="mt-2 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-700 transition hover:bg-amber-100 dark:border-amber-700/70 dark:bg-amber-900/30 dark:text-amber-200 dark:hover:bg-amber-900/45"
                >
                  Open inbox
                </button>
              </div>
            ) : null}

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

            {isTeacher && activeJoinUrl ? (
              <div className="rounded-2xl border border-slate-200 bg-white/95 p-3 dark:border-slate-700 dark:bg-slate-800/70">
                <div className="mb-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">Scan to join</div>
                <div className="flex justify-center">
                  <SessionQRCode value={activeJoinUrl} size={320} className="h-40 w-40 rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-700" />
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

        {endingSession ? (
          <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/55 px-4 backdrop-blur-sm">
            <div
              role="status"
              aria-live="polite"
              className="w-full max-w-md rounded-2xl border border-slate-200/80 bg-white/95 p-6 text-center shadow-2xl dark:border-slate-700/80 dark:bg-slate-900/95"
            >
              <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-slate-300 border-t-sky-600 dark:border-slate-700 dark:border-t-sky-400" />
              <h3 className="mt-4 text-base font-semibold text-slate-900 dark:text-slate-100">Generating analytics report</h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                {endSessionProgressMessage || 'Please wait while we finalize your session report.'}
              </p>
            </div>
          </div>
        ) : null}

        {showSessionPanel ? (
          <div
            className="fixed inset-0 z-40 flex justify-end bg-slate-950/45 p-3 backdrop-blur-sm"
            onMouseDown={handlePanelBackdropMouseDown}
            onClick={(event) => handlePanelBackdropClick(event, () => setShowSessionPanel(false))}
          >
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

              <label className="mb-1 block text-sm font-medium">Mode</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="mb-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none ring-sky-200 focus:ring dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:ring-sky-500/40"
                disabled={joined}
              >
                <option value="student">Join existing session</option>
                <option value="teacher">Host a new session</option>
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
                  value={activeJoinUrl}
                  readOnly
                  className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-700 shadow-sm outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  placeholder="Join URL appears when a session code is set"
                />
                <button
                  type="button"
                  onClick={copyJoinLink}
                  disabled={!activeJoinUrl}
                  className="grid h-10 w-10 place-items-center rounded-lg border border-slate-300 text-lg text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  title="Copy student join URL"
                  aria-label="Copy student join URL"
                >
                  <Icon name="copy" className="h-5 w-5" />
                </button>
              </div>

              {isTeacher && activeJoinUrl ? (
                <div className="mb-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/80">
                  <div className="mb-2 text-center text-sm font-semibold text-slate-700 dark:text-slate-100">Students: scan to join</div>
                  <div className="flex justify-center">
                    <SessionQRCode value={activeJoinUrl} size={420} className="h-[300px] w-[300px] rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-700" />
                  </div>
                  <div className="mt-3 text-center text-4xl font-black tracking-widest text-slate-900 dark:text-slate-100">{activeSessionCode}</div>
                </div>
              ) : null}

              {!joined ? (
                <div className="space-y-2">
                  {hasRejoinCandidate ? (
                    <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-700/80 dark:bg-emerald-900/25 dark:text-emerald-200">
                      <div className="font-semibold">Recent session found</div>
                      <div className="mt-1">
                        {rejoinCandidate.role === 'teacher' ? 'Host' : 'Student'} in {rejoinCandidate.session_code} as {rejoinCandidate.name}
                      </div>
                      <div className="mt-1 text-[11px] opacity-80">
                        Last active {Math.max(0, Math.round(rejoinCandidate.seconds_since_last_activity || 0))}s ago.
                      </div>
                      <button
                        type="button"
                        onClick={rejoinLastSession}
                        className="mt-2 w-full rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600"
                      >
                        Rejoin recent session
                      </button>
                    </div>
                  ) : null}
                  {isTeacher ? (
                    <button
                      type="button"
                      onClick={createSession}
                      className="w-full rounded-lg bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-slate-200"
                    >
                      Host session
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
                  {rejoinLookupPending ? (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-300">
                      Checking for rejoin options...
                    </div>
                  ) : null}
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

              {endingSession ? (
                <div
                  role="status"
                  aria-live="polite"
                  className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700/80 dark:bg-amber-900/30 dark:text-amber-100"
                >
                  <div className="font-semibold">Preparing analytics report...</div>
                  <div className="mt-1">{endSessionProgressMessage || 'Please wait while we finalize your session report.'}</div>
                </div>
              ) : null}
            </aside>
          </div>
        ) : null}

        {showNotesPanel ? (
          <div
            className="fixed inset-0 z-40 flex justify-end bg-slate-950/45 p-3 backdrop-blur-sm"
            onMouseDown={handlePanelBackdropMouseDown}
            onClick={(event) => handlePanelBackdropClick(event, () => setShowNotesPanel(false))}
          >
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
          <div
            className="fixed inset-0 z-40 grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm"
            onMouseDown={handlePanelBackdropMouseDown}
            onClick={(event) => handlePanelBackdropClick(event, () => setShowAwardsPanel(false))}
          >
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

        {showLibraryPanel ? (
          <div
            className="fixed inset-0 z-40 grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm"
            onMouseDown={handlePanelBackdropMouseDown}
            onClick={(event) => handlePanelBackdropClick(event, () => setShowLibraryPanel(false))}
          >
            <section
              className="flex max-h-[calc(100vh-2rem)] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white/95 p-5 shadow-2xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold uppercase tracking-[-0.02em] text-[#1a1a1a] dark:text-slate-100">Sessions / files / quizzes</h2>
                <button
                  type="button"
                  onClick={() => setShowLibraryPanel(false)}
                  className="grid h-8 w-8 place-items-center rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  title="Close"
                  aria-label="Close"
                >
                  <Icon name="close" className="h-4 w-4" />
                </button>
              </div>

              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
                  {['sessions', 'files', 'quizzes'].map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setLibraryTab(tab)}
                      className={`rounded-lg px-3 py-2 text-sm font-medium capitalize transition ${libraryTab === tab ? 'bg-white text-slate-900 shadow dark:bg-slate-700 dark:text-slate-100' : 'text-slate-600 dark:text-slate-300'}`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => refreshLibraryData()}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  Refresh
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                {libraryLoading ? (
                  <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">Loading library data...</div>
                ) : null}

                {!libraryLoading && libraryTab === 'sessions' ? (
                  <div className="space-y-2">
                    {librarySessions.length ? (
                      librarySessions.map((item) => (
                        <button
                          key={`${item.code}-${item.created_at}`}
                          type="button"
                          onClick={() => useLibrarySession(item.code)}
                          className={`w-full rounded-xl border px-3 py-2 text-left text-sm transition dark:bg-slate-800/70 ${activeLibrarySessionCode === String(item.code || '').trim().toUpperCase() ? 'border-sky-400 bg-sky-50 dark:border-sky-500 dark:bg-sky-900/20' : 'border-slate-200 bg-white dark:border-slate-700'}`}
                        >
                          <div className="font-semibold text-slate-900 dark:text-slate-100">{item.code}</div>
                          <div className="text-slate-600 dark:text-slate-300">Teacher: {item.teacher_name}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">{new Date(item.created_at).toLocaleString()}</div>
                        </button>
                      ))
                    ) : (
                      <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">No sessions found for this account yet.</div>
                    )}
                  </div>
                ) : null}

                {!libraryLoading && libraryTab === 'files' ? (
                  <div className="space-y-3">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
                      Session context: {activeLibrarySessionCode || 'your personal uploads'}
                    </div>
                    {isTeacher ? (
                      <div className="flex items-center gap-3">
                        <label className="inline-flex cursor-pointer items-center rounded-lg bg-sky-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-sky-600">
                          {uploadPending ? 'Uploading...' : 'Upload presentation'}
                          <input type="file" className="hidden" onChange={onUploadPresentation} disabled={uploadPending} />
                        </label>
                        {!normalizedCode ? (
                          <span className="text-xs text-slate-500 dark:text-slate-400">Pick or create a session first.</span>
                        ) : null}
                      </div>
                    ) : (
                      <div className="text-xs text-slate-500 dark:text-slate-400">Student mode: files are read-only. Join a session code to see teacher uploads.</div>
                    )}
                    {libraryFiles.length ? (
                      libraryFiles.map((item) => (
                        <div key={item.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800/70">
                          <div>
                            <div className="font-semibold text-slate-900 dark:text-slate-100">{item.original_name}</div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">{Math.round(item.size_bytes / 1024)} KB · {new Date(item.created_at).toLocaleString()}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => generatePresentationNotesPng(item)}
                              disabled={Boolean(notesPngPendingById[item.id])}
                              className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-700/60 dark:bg-emerald-900/20 dark:text-emerald-300 dark:hover:bg-emerald-900/35"
                            >
                              {notesPngPendingById[item.id] ? 'Generating PNG...' : 'AI notes PNG'}
                            </button>
                            <button
                              type="button"
                              onClick={() => downloadPresentation(item)}
                              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                            >
                              Download
                            </button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">No uploaded presentations yet.</div>
                    )}
                  </div>
                ) : null}

                {!libraryLoading && libraryTab === 'quizzes' ? (
                  <div className="space-y-3">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
                      Session context: {activeLibrarySessionCode || 'your saved session quizzes'}
                    </div>
                    {libraryQuizzes.length ? (
                      libraryQuizzes.map((item) => (
                        <div key={item.id} className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm dark:border-slate-700 dark:bg-slate-800/70">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">{item.question}</div>
                          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Session: {item.session_code || '-'} · {new Date(item.created_at).toLocaleString()}</div>
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <div className="text-xs text-slate-600 dark:text-slate-300">
                              {item.answer_revealed ? 'Practice mode: result will be shown after answering.' : 'Live quiz: correct answer hidden until host closes quiz.'}
                            </div>
                            {item.is_live ? <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">Live</span> : null}
                          </div>
                          <div className="mt-2">
                            <button
                              type="button"
                              onClick={() => openSavedQuizAttempt(item)}
                              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                            >
                              Practice this quiz
                            </button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">No saved quizzes yet.</div>
                    )}
                  </div>
                ) : null}
              </div>
            </section>
          </div>
        ) : null}

        {showSavedQuizAttemptPanel && savedQuizAttemptItem ? (
          <div
            className="fixed inset-0 z-40 grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm"
            onMouseDown={handlePanelBackdropMouseDown}
            onClick={(event) => handlePanelBackdropClick(event, () => setShowSavedQuizAttemptPanel(false))}
          >
            <section
              className="w-full max-w-2xl rounded-3xl border border-slate-200 bg-white/95 p-5 shadow-2xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm font-bold uppercase tracking-[-0.02em] text-[#1a1a1a] dark:text-slate-100">Practice quiz</h2>
                <button
                  type="button"
                  onClick={() => setShowSavedQuizAttemptPanel(false)}
                  className="grid h-8 w-8 place-items-center rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  title="Close"
                  aria-label="Close"
                >
                  <Icon name="close" className="h-4 w-4" />
                </button>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/70">
                <div className="text-base font-semibold text-slate-900 dark:text-slate-100">{savedQuizAttemptItem.question}</div>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Session: {savedQuizAttemptItem.session_code || '-'} · {new Date(savedQuizAttemptItem.created_at).toLocaleString()}</div>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {savedQuizAttemptOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    disabled={Boolean(savedQuizAttemptChoice)}
                    onClick={() => submitSavedQuizAttempt(option.id)}
                    className={`rounded-2xl border px-4 py-3 text-left text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-70 ${savedQuizAttemptChoice === option.id
                        ? 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-400 dark:bg-sky-900/30 dark:text-sky-100'
                        : 'border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100 dark:hover:bg-slate-700/85'
                      }`}
                  >
                    <span className="mr-2 font-bold">{option.id}.</span>
                    {option.text}
                  </button>
                ))}
              </div>

              {savedQuizAttemptResult === 'correct' ? (
                <div className="mt-3 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 dark:border-emerald-700/60 dark:bg-emerald-900/20 dark:text-emerald-300">
                  Correct.
                </div>
              ) : null}
              {savedQuizAttemptResult === 'incorrect' ? (
                <div className="mt-3 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 dark:border-rose-700/60 dark:bg-rose-900/20 dark:text-rose-300">
                  Incorrect. Correct answer: {savedQuizAttemptItem.correct_option_id}
                </div>
              ) : null}
              {savedQuizAttemptResult === 'hidden' ? (
                <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-300">
                  Answer submitted. The host has not finished this live quiz yet, so correct answer is hidden.
                </div>
              ) : null}

              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={retrySavedQuizAttempt}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                >
                  Try again (reshuffle)
                </button>
                <button
                  type="button"
                  onClick={() => setShowSavedQuizAttemptPanel(false)}
                  className="rounded-lg bg-sky-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-sky-600"
                >
                  Done
                </button>
              </div>
            </section>
          </div>
        ) : null}

        {showQuizPromptPanel && isTeacher ? (
          <div
            className="fixed inset-0 z-40 grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm"
            onMouseDown={handlePanelBackdropMouseDown}
            onClick={(event) => handlePanelBackdropClick(event, () => setShowQuizPromptPanel(false))}
          >
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

              <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">Choose a preset style or keep default, then generate from the current notes.</p>

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

        {showQuestionsPanel && isTeacher ? (
          <div
            className="fixed inset-0 z-40 grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm"
            onMouseDown={handlePanelBackdropMouseDown}
            onClick={(event) => handlePanelBackdropClick(event, () => setShowQuestionsPanel(false))}
          >
            <section
              className="flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white/95 p-5 shadow-2xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm font-bold uppercase tracking-[-0.02em] text-[#1a1a1a] dark:text-slate-100">Anonymous question inbox</h2>
                <button
                  type="button"
                  onClick={() => setShowQuestionsPanel(false)}
                  className="grid h-8 w-8 place-items-center rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  title="Close"
                  aria-label="Close"
                >
                  <Icon name="close" className="h-4 w-4" />
                </button>
              </div>

              <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
                Pending questions: <span className="font-semibold">{pendingQuestionCount}</span>
              </div>

              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                {anonymousQuestions.length ? (
                  anonymousQuestions.map((question) => (
                    <div key={question.id} className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm dark:border-slate-700 dark:bg-slate-800/70">
                      <div className="text-slate-900 dark:text-slate-100">{question.text}</div>
                      <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                        Asked: {question.created_at ? new Date(question.created_at).toLocaleString() : '-'}
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <div className={`text-xs font-semibold uppercase tracking-wide ${question.resolved ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
                          {question.resolved ? 'Resolved' : 'Pending'}
                        </div>
                        {!question.resolved ? (
                          <button
                            type="button"
                            onClick={() => markQuestionResolved(question.id)}
                            className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 dark:border-emerald-700/60 dark:bg-emerald-900/20 dark:text-emerald-300 dark:hover:bg-emerald-900/35"
                          >
                            Mark resolved
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
                    No anonymous questions yet.
                  </div>
                )}
              </div>
            </section>
          </div>
        ) : null}

        {showAskQuestionPanel && !isTeacher ? (
          <div
            className="fixed inset-0 z-40 grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm"
            onMouseDown={handlePanelBackdropMouseDown}
            onClick={(event) => handlePanelBackdropClick(event, () => setShowAskQuestionPanel(false))}
          >
            <section
              className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white/95 p-5 shadow-2xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold uppercase tracking-[-0.02em] text-[#1a1a1a] dark:text-slate-100">Ask anonymous question</h2>
                <button
                  type="button"
                  onClick={() => setShowAskQuestionPanel(false)}
                  className="grid h-8 w-8 place-items-center rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  title="Close"
                  aria-label="Close"
                >
                  <Icon name="close" className="h-4 w-4" />
                </button>
              </div>

              <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
                Your name is not shown to the host. Keep your question clear and specific.
              </p>

              <textarea
                value={anonymousQuestionDraft}
                onChange={(event) => setAnonymousQuestionDraft(event.target.value)}
                rows={5}
                maxLength={600}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none ring-sky-200 focus:ring dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:ring-sky-500/40"
                placeholder="Example: Could you explain why this formula uses a logarithm here?"
              />
              <div className="mt-1 text-right text-xs text-slate-500 dark:text-slate-400">{anonymousQuestionDraft.length}/600</div>

              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAskQuestionPanel(false)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submitAnonymousQuestion}
                  disabled={anonymousQuestionSubmitting || !anonymousQuestionDraft.trim()}
                  className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {anonymousQuestionSubmitting ? 'Sending...' : 'Send anonymously'}
                </button>
              </div>
            </section>
          </div>
        ) : null}

        {showStudentReplayPanel && !isTeacher ? (
          <div
            className="fixed inset-0 z-40 grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm"
            onMouseDown={handlePanelBackdropMouseDown}
            onClick={(event) => handlePanelBackdropClick(event, closeStudentReplayPanel)}
          >
            <section
              className="flex max-h-[calc(100vh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white/95 p-5 shadow-2xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-bold uppercase tracking-[-0.02em] text-[#1a1a1a] dark:text-slate-100">Last minute replay</h2>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                    Frame capture is paused for your session while this window is open.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeStudentReplayPanel}
                  className="grid h-8 w-8 place-items-center rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  title="Close"
                  aria-label="Close"
                >
                  <Icon name="close" className="h-4 w-4" />
                </button>
              </div>

              {studentReplayFrames.length ? (
                <>
                  <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 dark:border-slate-700">
                    <img
                      src={studentReplayFrames[selectedReplayFrameIndex]?.dataUrl}
                      alt={`Replay frame ${selectedReplayFrameIndex + 1}`}
                      className="h-full w-full object-contain"
                    />
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedReplayFrameIndex((currentIndex) => Math.max(0, currentIndex - 1))}
                      disabled={selectedReplayFrameIndex <= 0}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                    >
                      Previous
                    </button>

                    <div className="text-center text-xs text-slate-600 dark:text-slate-300">
                      Frame {selectedReplayFrameIndex + 1} of {studentReplayFrames.length}
                      <div>
                        {new Date(studentReplayFrames[selectedReplayFrameIndex]?.capturedAt || Date.now()).toLocaleTimeString()}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        setSelectedReplayFrameIndex((currentIndex) =>
                          Math.min(studentReplayFrames.length - 1, currentIndex + 1),
                        )
                      }
                      disabled={selectedReplayFrameIndex >= studentReplayFrames.length - 1}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                    >
                      Next
                    </button>
                  </div>
                </>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
                  No live frame available yet. Ask the host to start/continue screen sharing.
                </div>
              )}
            </section>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default App
