import { ArrowRight, Beef, CalendarDays, Footprints, GlassWater, Hand, Scale, Utensils } from 'lucide-react'
import { Link } from 'react-router-dom'

const meals = [
  { title: 'Завтрак', copy: 'Каша, 3 яйца и порция греческого йогурта или творога.' },
  { title: 'Обед', copy: 'Две ладони мяса или рыбы, горсть гарнира и 1–2 кулака овощей.' },
  { title: 'Ужин', copy: 'Две ладони белка, овощи и одна горсть гарнира. После тренировки — полторы.' },
  { title: 'Если нужен 4-й приём', copy: 'Творог, греческий йогурт или протеиновый напиток плюс фрукт.' },
]

export function NutritionPlan() {
  return (
    <>
      <section className="plan-hero" aria-label="Цели питания и активности">
        <div><span>Калории</span><strong>2300–2400</strong><small>стартовый диапазон</small></div>
        <div><span>Белок</span><strong>150–160 г</strong><small>каждый день</small></div>
        <div><span>Темп</span><strong>−0,3–0,6 кг</strong><small>в неделю</small></div>
      </section>

      <section className="section-block">
        <div className="section-heading"><div><p className="eyebrow">Расписание</p><h2>Две основные + бонус</h2></div></div>
        <div className="schedule-card">
          <div><CalendarDays /><span>Понедельник</span><strong>Тренировка A</strong></div>
          <ArrowRight aria-hidden="true" />
          <div><span>Среда</span><strong>Тренировка B</strong></div>
          <ArrowRight aria-hidden="true" />
          <div className="optional-day"><span>Суббота</span><strong>C · дополнительно</strong></div>
        </div>
        <p className="plan-note">Если суббота пропущена, ничего компенсировать не нужно. После C — 15–20 минут спокойной ходьбы под наклоном.</p>
      </section>

      <section className="section-block">
        <div className="section-heading"><div><p className="eyebrow">Без весов</p><h2>Собери тарелку руками</h2></div></div>
        <div className="portion-grid">
          <article><Beef /><strong>2 ладони</strong><span>мясо, птица, рыба или творог</span></article>
          <article><Hand /><strong>1 горсть</strong><span>рис, гречка, картофель или каша</span></article>
          <article><Utensils /><strong>1–2 кулака</strong><span>овощи и зелень</span></article>
          <article><span className="thumb-mark">●</span><strong>1 палец</strong><span>масло, сыр, орехи или соус</span></article>
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading"><div><p className="eyebrow">3 или 4 раза</p><h2>Пример дня</h2></div></div>
        <div className="meal-list">
          {meals.map((meal, index) => (
            <article key={meal.title}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <div><strong>{meal.title}</strong><p>{meal.copy}</p></div>
            </article>
          ))}
        </div>
      </section>

      <section className="alcohol-card">
        <GlassWater />
        <div>
          <p className="eyebrow">Алкоголь</p>
          <h2>Один вечер в неделю</h2>
          <p>До двух бокалов вина или двух бутылок пива по 0,33 л. Между порциями — вода, без калорийных закусок.</p>
        </div>
      </section>

      <section className="control-card">
        <div><Scale /><strong>Контроль раз в неделю</strong></div>
        <p>Смотри на средний вес, а не на одну цифру. Талию измеряй утром на уровне пупка, не втягивая живот.</p>
        <div className="control-row"><Footprints /><span>Цель активности</span><strong>9–10 тыс. шагов</strong></div>
        <Link className="primary-button wide" to="/training/body">Добавить вес и талию</Link>
      </section>
    </>
  )
}
