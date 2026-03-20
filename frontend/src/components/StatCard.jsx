export function StatCard({ label, value, help }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800/80">
      <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className="text-2xl font-semibold text-slate-900 dark:text-white">{value}</div>
      {help ? <div className="text-xs text-slate-500 dark:text-slate-500">{help}</div> : null}
    </div>
  )
}
