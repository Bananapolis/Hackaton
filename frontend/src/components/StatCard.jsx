export function StatCard({ label, value, help }) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/80 p-3 shadow">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-2xl font-semibold text-white">{value}</div>
      {help ? <div className="text-xs text-slate-500">{help}</div> : null}
    </div>
  )
}
