export function QuizOverlay({ quiz, onAnswer, readonly, selectedOptionId }) {
  if (!quiz) return null

  const locked = readonly || Boolean(selectedOptionId)

  return (
    <div className="rounded-2xl border border-indigo-200 bg-white/95 p-5 shadow-xl dark:border-indigo-900/70 dark:bg-indigo-950/70">
      <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">Live quiz</div>
      <div className="mb-4 text-2xl font-semibold leading-tight text-slate-900 dark:text-white lg:text-3xl">{quiz.question}</div>
      <div className="grid gap-2 sm:grid-cols-2">
        {quiz.options.map((option) => (
          <button
            key={option.id}
            type="button"
            disabled={locked}
            onClick={() => onAnswer?.(option.id)}
            className={`rounded-xl border px-4 py-3 text-left text-base font-medium text-slate-800 transition disabled:cursor-not-allowed disabled:opacity-70 dark:text-indigo-100 lg:text-lg ${
              selectedOptionId === option.id
                ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-300/80 dark:bg-emerald-900/40'
                : 'border-slate-300 bg-slate-50 hover:bg-slate-100 dark:border-indigo-300/40 dark:bg-indigo-900/40 dark:hover:bg-indigo-800/60'
            }`}
          >
            <span className="mr-2 text-lg font-bold">{option.id}.</span>
            {option.text}
          </button>
        ))}
      </div>
      {selectedOptionId ? (
        <div className="mt-3 text-base font-semibold text-emerald-700 dark:text-emerald-200">Answer submitted: {selectedOptionId}</div>
      ) : null}
    </div>
  )
}
