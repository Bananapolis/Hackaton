export function StatCard({ label, value, help }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-gradient-to-b from-white to-slate-50 p-3.5 shadow-[0_10px_24px_-20px_rgba(15,23,42,0.9)] dark:border-slate-700 dark:from-slate-800 dark:to-slate-900/80">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 text-3xl font-semibold text-slate-900 dark:text-white">{value}</div>
      {help ? <div className="mt-1 text-xs text-slate-500 dark:text-slate-500">{help}</div> : null}
    </div>
  )
}
