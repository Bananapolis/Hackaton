export function QuizOverlay({ quiz, onAnswer, readonly, selectedOptionId, large = false, votingClosed = false }) {
  if (!quiz) return null

  const locked = readonly || Boolean(selectedOptionId)

  return (
    <div
      className={`rounded-3xl border border-white/40 bg-white/95 p-5 shadow-[0_30px_90px_-35px_rgba(15,23,42,0.95)] backdrop-blur-2xl dark:border-slate-700/80 dark:bg-slate-900/92 ${
        large ? 'w-[min(94vw,1400px)] max-h-[86vh] overflow-y-auto p-8' : ''
      }`}
    >
      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-indigo-700 dark:text-indigo-300">Live quiz</div>
      <div className={`mb-5 font-semibold leading-tight text-slate-900 dark:text-white ${large ? 'text-4xl lg:text-6xl' : 'text-2xl lg:text-3xl'}`}>
        {quiz.question}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {quiz.options.map((option) => (
          <button
            key={option.id}
            type="button"
            disabled={locked}
            onClick={() => onAnswer?.(option.id)}
            className={`rounded-2xl border px-4 py-3 text-left font-medium text-slate-800 transition disabled:cursor-not-allowed disabled:opacity-70 dark:text-indigo-100 ${
              selectedOptionId === option.id
                ? 'border-emerald-300 bg-emerald-50 shadow-sm dark:border-emerald-300/80 dark:bg-emerald-900/40'
                : 'border-slate-200 bg-slate-50/90 hover:border-indigo-300 hover:bg-indigo-50/70 dark:border-indigo-300/40 dark:bg-indigo-900/40 dark:hover:bg-indigo-800/60'
            } ${large ? 'py-5 text-2xl lg:text-3xl' : 'text-base lg:text-lg'}`}
          >
            <span className={`${large ? 'mr-3 text-3xl' : 'mr-2 text-lg'} font-bold`}>{option.id}.</span>
            {option.text}
          </button>
        ))}
      </div>
      {votingClosed ? (
        <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-base font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
          Voting is currently closed by the teacher.
        </div>
      ) : null}
      {selectedOptionId ? (
        <div className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-base font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200">Answer submitted: {selectedOptionId}</div>
      ) : null}
    </div>
  )
}
