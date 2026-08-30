type Point = { label: string; value: number }

export function LineChart({ points, unit }: { points: Point[]; unit: string }) {
  if (!points.length) return <div className="chart-empty">Появится после первых записей</div>
  const width = 360
  const height = 150
  const padding = 20
  const values = points.map((point) => point.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const coords = points.map((point, index) => ({
    x: padding + (index * (width - padding * 2)) / Math.max(1, points.length - 1),
    y: height - padding - ((point.value - min) / range) * (height - padding * 2),
    ...point,
  }))
  const path = coords.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ')

  return (
    <div className="line-chart" aria-label={`График, ${unit}`}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img">
        <path className="chart-grid" d={`M ${padding} ${height / 2} H ${width - padding}`} />
        <path className="chart-line" d={path} />
        {coords.map((point) => (
          <g key={`${point.label}-${point.x}`}>
            <circle cx={point.x} cy={point.y} r="4" />
            <title>{`${point.label}: ${point.value} ${unit}`}</title>
          </g>
        ))}
      </svg>
      <div className="chart-axis">
        <span>{points[0]?.label}</span>
        <strong>{points.at(-1)?.value} {unit}</strong>
        <span>{points.at(-1)?.label}</span>
      </div>
    </div>
  )
}
