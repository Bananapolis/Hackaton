import { useEffect, useState } from 'react'

function remainingSeconds(endTimeEpoch) {
  if (!endTimeEpoch) return 0
  return Math.max(0, Math.floor(endTimeEpoch - Date.now() / 1000))
}

export function CountdownBanner({ endTimeEpoch }) {
  const [secondsLeft, setSecondsLeft] = useState(remainingSeconds(endTimeEpoch))

  useEffect(() => {
    setSecondsLeft(remainingSeconds(endTimeEpoch))
    if (!endTimeEpoch) return

    const timer = window.setInterval(() => {
      setSecondsLeft(remainingSeconds(endTimeEpoch))
    }, 500)

    return () => window.clearInterval(timer)
  }, [endTimeEpoch])

  if (!endTimeEpoch || secondsLeft <= 0) return null

  const minutes = Math.floor(secondsLeft / 60)
  const seconds = String(secondsLeft % 60).padStart(2, '0')

  return (
    <div className="mb-4 flex items-center justify-between rounded-2xl border border-sky-200/75 bg-gradient-to-r from-white via-slate-50 to-sky-50/60 px-4 py-2.5 text-slate-800 shadow-[0_16px_30px_-26px_rgba(15,23,42,0.85)] dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800 dark:text-slate-100">
      <span className="text-sm font-semibold">Break active</span>
      <span className="rounded-full bg-slate-900/8 px-3 py-1 text-sm font-semibold tracking-wide dark:bg-slate-100/10">Resuming in {minutes}:{seconds}</span>
    </div>
  )
}
