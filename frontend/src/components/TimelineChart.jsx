import { useMemo, useState } from 'react'

export function TimelineChart({ points, valueKey, label, color = '#0284c7', unit = '' }) {
  const [hoverIndex, setHoverIndex] = useState(null)

  const series = useMemo(() => {
    if (!Array.isArray(points) || points.length === 0) return []
    const sorted = [...points].sort(
      (a, b) => Number(a.recorded_at_epoch || 0) - Number(b.recorded_at_epoch || 0),
    )
    const start = Number(sorted[0].recorded_at_epoch || 0)
    return sorted.map((point, index) => ({
      index,
      elapsedSeconds: Math.max(0, Number(point.recorded_at_epoch || 0) - start),
      value: Number(point[valueKey] || 0),
      raw: point,
    }))
  }, [points, valueKey])

  if (series.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
        No data captured yet for {label.toLowerCase()}.
      </div>
    )
  }

  const width = 560
  const height = 180
  const padLeft = 36
  const padRight = 12
  const padTop = 12
  const padBottom = 26
  const innerWidth = width - padLeft - padRight
  const innerHeight = height - padTop - padBottom

  const maxValue = Math.max(...series.map((p) => p.value), 1)
  const maxElapsed = Math.max(series[series.length - 1].elapsedSeconds, 1)

  const xFor = (elapsed) =>
    padLeft + (series.length === 1 ? innerWidth / 2 : (elapsed / maxElapsed) * innerWidth)
  const yFor = (value) => padTop + innerHeight - (value / maxValue) * innerHeight

  const pathD = series
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${xFor(point.elapsedSeconds).toFixed(1)},${yFor(point.value).toFixed(1)}`)
    .join(' ')

  const areaD = `${pathD} L${xFor(series[series.length - 1].elapsedSeconds).toFixed(1)},${(padTop + innerHeight).toFixed(1)} L${xFor(series[0].elapsedSeconds).toFixed(1)},${(padTop + innerHeight).toFixed(1)} Z`

  function formatElapsed(seconds) {
    const total = Math.max(0, Math.round(seconds))
    const m = Math.floor(total / 60)
    const s = total % 60
    return `${m}m ${s.toString().padStart(2, '0')}s`
  }

  function handlePointerMove(event) {
    const svg = event.currentTarget
    const rect = svg.getBoundingClientRect()
    const relativeX = ((event.clientX - rect.left) / rect.width) * width
    let closest = 0
    let closestDist = Infinity
    series.forEach((point, index) => {
      const dist = Math.abs(xFor(point.elapsedSeconds) - relativeX)
      if (dist < closestDist) {
        closestDist = dist
        closest = index
      }
    })
    setHoverIndex(closest)
  }

  const hovered = hoverIndex != null ? series[hoverIndex] : null
  const hoveredX = hovered ? xFor(hovered.elapsedSeconds) : 0
  const hoveredY = hovered ? yFor(hovered.value) : 0
  const tooltipSide = hovered && hoveredX > width * 0.65 ? 'left' : 'right'

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900/70">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
          {label}
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          {series.length} {series.length === 1 ? 'point' : 'points'}
        </div>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full touch-none select-none"
        role="img"
        aria-label={`${label} timeline`}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoverIndex(null)}
      >
        <defs>
          <linearGradient id={`grad-${valueKey}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = padTop + innerHeight - ratio * innerHeight
          return (
            <g key={ratio}>
              <line
                x1={padLeft}
                x2={width - padRight}
                y1={y}
                y2={y}
                stroke="currentColor"
                strokeOpacity="0.08"
              />
              <text
                x={padLeft - 6}
                y={y + 3}
                textAnchor="end"
                fontSize="9"
                fill="currentColor"
                fillOpacity="0.55"
              >
                {Math.round(maxValue * ratio)}
                {unit}
              </text>
            </g>
          )
        })}
        <path d={areaD} fill={`url(#grad-${valueKey})`} />
        <path d={pathD} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {series.map((point) => (
          <circle
            key={point.index}
            cx={xFor(point.elapsedSeconds)}
            cy={yFor(point.value)}
            r={hoverIndex === point.index ? 4 : 2.5}
            fill={color}
          />
        ))}
        <text
          x={padLeft}
          y={height - 6}
          fontSize="9"
          fill="currentColor"
          fillOpacity="0.55"
        >
          0m
        </text>
        <text
          x={width - padRight}
          y={height - 6}
          textAnchor="end"
          fontSize="9"
          fill="currentColor"
          fillOpacity="0.55"
        >
          {formatElapsed(maxElapsed)}
        </text>
        {hovered ? (
          <g>
            <line
              x1={hoveredX}
              x2={hoveredX}
              y1={padTop}
              y2={padTop + innerHeight}
              stroke={color}
              strokeDasharray="3 3"
              strokeOpacity="0.6"
            />
            <circle cx={hoveredX} cy={hoveredY} r="5" fill={color} stroke="white" strokeWidth="1.5" />
          </g>
        ) : null}
      </svg>
      {hovered ? (
        <div
          className={`mt-2 flex ${tooltipSide === 'left' ? 'justify-end' : 'justify-start'}`}
        >
          <div className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] shadow dark:border-slate-700 dark:bg-slate-800">
            <div className="font-semibold text-slate-900 dark:text-slate-100">
              {hovered.value}
              {unit} at {formatElapsed(hovered.elapsedSeconds)}
            </div>
            <div className="text-slate-500 dark:text-slate-400">
              Source: {hovered.raw?.source || 'tick'}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
