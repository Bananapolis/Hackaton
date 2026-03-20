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
    <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-amber-800 shadow-sm dark:border-amber-500/70 dark:bg-amber-900/30 dark:text-amber-200">
      Break active. Resuming in {minutes}:{seconds}
    </div>
  )
}
