import { useId } from 'react'

const effortGuide = [
  { min: 1, max: 2, title: 'Очень легко', cue: 'Дыхание спокойное, разговариваешь свободно.' },
  { min: 3, max: 4, title: 'Легко', cue: 'Дыхание немного участилось, разговор даётся легко.' },
  { min: 5, max: 6, title: 'Умеренно', cue: 'Дышишь заметно чаще. Можешь разговаривать, но петь уже трудно.' },
  { min: 7, max: 8, title: 'Тяжело', cue: 'Можешь сказать лишь несколько слов, затем нужна пауза на вдох.' },
  { min: 9, max: 9, title: 'Очень тяжело', cue: 'Продолжать трудно, говорить почти не получается.' },
  { min: 10, max: 10, title: 'Максимум', cue: 'Твой предел усилия. Это описание ощущения, а не цель обычного кардио.' },
]

export function EffortPicker({ value, onChange }: { value: number | null; onChange: (value: number | null) => void }) {
  const id = useId()
  const selected = effortGuide.find((item) => value !== null && value >= item.min && value <= item.max)
  return (
    <fieldset className="effort-picker">
      <legend>Усилие, 1–10 · как тяжело тебе</legend>
      <p id={`${id}-help`}>Оцени дыхание и общую усталость в основной части кардио. Скорость и пульс сами по себе не определяют оценку.</p>
      <div className="effort-options" role="radiogroup" aria-label="Усилие, 1–10" aria-describedby={`${id}-help`}>
        {Array.from({ length: 10 }, (_, index) => index + 1).map((score) => {
          const guide = effortGuide.find((item) => score >= item.min && score <= item.max)!
          return <label key={score} className={value === score ? 'selected' : ''}><input type="radio" name={id} value={score} checked={value === score} aria-label={`${score} из 10 — ${guide.title}`} onChange={() => onChange(score)} /><span>{score}</span></label>
        })}
      </div>
      <div className="effort-current" role="status"><strong>{selected ? `${value}/10 · ${selected.title}` : 'Выбери ощущение после кардио'}</strong><span>{selected?.cue ?? '1 — минимальное усилие, 10 — твой максимум. Если не оценивал, оставь поле пустым.'}</span></div>
      <button type="button" className="text-button" onClick={() => onChange(null)} disabled={value === null}>Не оценивал</button>
      <details className="effort-guide"><summary>Как выбрать число</summary><dl>{effortGuide.map((item) => <div key={item.min}><dt>{item.min === item.max ? item.min : `${item.min}–${item.max}`} · {item.title}</dt><dd>{item.cue}</dd></div>)}</dl><p>Умеренное кардио обычно соответствует 5–6/10. Ощущения у каждого свои.</p><a href="https://www.cdc.gov/physical-activity-basics/measuring/index.html" target="_blank" rel="noreferrer">О шкале усилия и разговорном тесте · CDC</a></details>
    </fieldset>
  )
}
