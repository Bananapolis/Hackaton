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
    <div className="mb-4 flex items-center justify-between rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 via-yellow-50 to-amber-50 px-4 py-2.5 text-amber-900 shadow-[0_12px_30px_-24px_rgba(217,119,6,0.9)] dark:border-amber-500/70 dark:from-amber-900/30 dark:via-amber-900/20 dark:to-amber-900/30 dark:text-amber-200">
      <span className="text-sm font-semibold">Break active</span>
      <span className="rounded-full bg-amber-900/10 px-3 py-1 text-sm font-semibold tracking-wide dark:bg-amber-100/10">Resuming in {minutes}:{seconds}</span>
    </div>
  )
}
