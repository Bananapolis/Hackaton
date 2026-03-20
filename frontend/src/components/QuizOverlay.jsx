export function QuizOverlay({ quiz, onAnswer, readonly }) {
  if (!quiz) return null

  return (
    <div className="rounded-xl border border-indigo-400 bg-indigo-950/60 p-4 shadow-lg backdrop-blur">
      <div className="mb-2 text-xs uppercase tracking-wide text-indigo-300">Live quiz</div>
      <div className="mb-3 text-lg font-semibold text-white">{quiz.question}</div>
      <div className="grid gap-2 sm:grid-cols-2">
        {quiz.options.map((option) => (
          <button
            key={option.id}
            type="button"
            disabled={readonly}
            onClick={() => onAnswer?.(option.id)}
            className="rounded-lg border border-indigo-300/40 bg-indigo-900/40 px-3 py-2 text-left text-indigo-100 transition hover:bg-indigo-800/60 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="mr-2 font-semibold">{option.id}.</span>
            {option.text}
          </button>
        ))}
      </div>
    </div>
  )
}
