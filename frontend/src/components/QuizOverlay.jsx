export function QuizOverlay({ quiz, onAnswer, readonly, selectedOptionId, large = false, votingClosed = false, answerRevealed = false, correctOptionId = null, perOption = null }) {
  if (!quiz) return null

  const locked = readonly || Boolean(selectedOptionId)

  return (
    <div
      className={`rounded-3xl border border-slate-200/90 bg-white/95 p-5 shadow-[0_30px_90px_-40px_rgba(2,6,23,0.95)] backdrop-blur-2xl dark:border-slate-700/80 dark:bg-slate-900/92 ${
        large ? 'w-[min(94vw,1400px)] max-h-[86vh] overflow-y-auto p-8' : ''
      }`}
    >
      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-sky-700 dark:text-sky-300">Live quiz</div>
      <div className={`mb-5 font-semibold leading-tight text-slate-900 dark:text-white ${large ? 'text-4xl lg:text-6xl' : 'text-2xl lg:text-3xl'}`}>
        {quiz.question}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {quiz.options.map((option) => {
          const isCorrect = answerRevealed && correctOptionId && option.id.toUpperCase() === String(correctOptionId).toUpperCase()
          const isWrong = answerRevealed && correctOptionId && selectedOptionId?.toUpperCase() === option.id.toUpperCase() && !isCorrect
          const pct = perOption?.[option.id]?.pct ?? null

          return (
            <button
              key={option.id}
              type="button"
              disabled={locked || answerRevealed}
              onClick={() => onAnswer?.(option.id)}
              className={`rounded-2xl border px-4 py-3 text-left font-medium transition disabled:cursor-not-allowed ${
                isCorrect
                  ? 'border-emerald-400 bg-emerald-50 text-emerald-800 dark:border-emerald-500/70 dark:bg-emerald-900/30 dark:text-emerald-200'
                  : isWrong
                  ? 'border-rose-300 bg-rose-50 text-rose-800 opacity-75 dark:border-rose-500/60 dark:bg-rose-900/25 dark:text-rose-300'
                  : selectedOptionId === option.id
                  ? 'border-sky-300 bg-sky-50 shadow-sm text-slate-800 dark:border-sky-300/70 dark:bg-sky-900/35 dark:text-slate-100'
                  : 'border-slate-200 bg-slate-50/95 text-slate-800 hover:border-slate-300 hover:bg-slate-100/85 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-100 dark:hover:bg-slate-700/85'
              } ${large ? 'py-5 text-2xl lg:text-3xl' : 'text-base lg:text-lg'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span>
                  <span className={`${large ? 'mr-3 text-3xl' : 'mr-2 text-lg'} font-bold`}>{option.id}.</span>
                  {option.text}
                </span>
                {answerRevealed && pct !== null ? (
                  <span className={`shrink-0 text-sm font-bold tabular-nums ${isCorrect ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-500 dark:text-slate-400'}`}>
                    {Math.round(pct * 100)}%
                  </span>
                ) : null}
              </div>
              {answerRevealed && pct !== null ? (
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${isCorrect ? 'bg-emerald-500' : 'bg-slate-400 dark:bg-slate-500'}`}
                    style={{ width: `${Math.round(pct * 100)}%` }}
                  />
                </div>
              ) : null}
            </button>
          )
        })}
      </div>
      {answerRevealed ? (
        <div className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-base font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200">
          ✓ Correct answer: {correctOptionId} — {quiz.options.find((o) => o.id.toUpperCase() === String(correctOptionId).toUpperCase())?.text}
        </div>
      ) : votingClosed ? (
        <div className="mt-3 rounded-xl bg-slate-100 px-3 py-2 text-base font-semibold text-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
          Voting is currently closed by the teacher.
        </div>
      ) : null}
      {!answerRevealed && selectedOptionId ? (
        <div className="mt-3 rounded-xl bg-sky-50 px-3 py-2 text-base font-semibold text-sky-700 dark:bg-sky-900/30 dark:text-sky-200">Answer submitted: {selectedOptionId}</div>
      ) : null}
    </div>
  )
}
