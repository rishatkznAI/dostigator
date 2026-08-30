import type { ExerciseWeightGuide } from '../lib/weight-guide'

export function WeightGuide({ guide }: { guide: ExerciseWeightGuide }) {
  return (
    <section className="weight-guide" aria-label="Стартовые ориентиры веса">
      <header>
        <span>Если упражнение новое</span>
        <small>Первый подход — лайт</small>
      </header>
      <div className="weight-guide-options">
        <div><span>Лайт</span><strong>{guide.light}</strong></div>
        <div className="working"><span>Рабочий</span><strong>{guide.working}</strong></div>
        <div><span>Попробовать</span><strong>{guide.tryNext}</strong></div>
      </div>
      <p>{guide.note} Рабочий выбирай при запасе ≥4 RIR; «попробовать» — при чистой технике и запасе ≥2 RIR.</p>
    </section>
  )
}
