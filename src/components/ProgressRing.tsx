import type { CSSProperties } from 'react'

export function ProgressRing({ value, label }: { value: number; label: string }) {
  const safe = Math.max(0, Math.min(100, value))
  return <div
    className="progress-ring"
    role="progressbar"
    aria-label="Прогресс"
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={safe}
    aria-valuetext={`${safe} ${label}`}
    style={{ '--progress': `${safe * 3.6}deg` } as CSSProperties}
  ><div><strong>{safe}</strong><span>{label}</span></div></div>
}
