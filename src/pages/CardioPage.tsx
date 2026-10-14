import { Activity, ArrowLeft, Bike, CircleAlert, Footprints, Gauge, HeartPulse, Timer, Wind } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { CardioJournal } from '../components/CardioJournal'

type CardioExercise = {
  title: string
  subtitle: string
  duration: string
  icon: LucideIcon
  steps: string[]
  cue: string
}

const cardioExercises: CardioExercise[] = [
  {
    title: 'Ходьба под уклоном',
    subtitle: 'Лучший вариант после силовой',
    duration: '20–30 мин',
    icon: Footprints,
    steps: [
      '5 мин спокойно: 3,5–4,5 км/ч, уклон 0–2%',
      '15–20 мин: 4,5–6 км/ч, уклон 3–8%',
      '3–5 мин заминки без уклона',
    ],
    cue: 'Не держись за поручни. Снизь уклон, если приходится заваливаться вперёд.',
  },
  {
    title: 'Велотренажёр',
    subtitle: 'Когда ноги устали или бережём суставы',
    duration: '20–35 мин',
    icon: Bike,
    steps: [
      'Настрой седло: в нижней точке колено слегка согнуто',
      '5 мин лёгкого вращения',
      '15–25 мин ровно, каденс примерно 70–90 об/мин',
    ],
    cue: 'Сопротивление умеренное: крути плавно, без раскачивания корпуса.',
  },
  {
    title: 'Эллипс',
    subtitle: 'Мягкая нагрузка на всё тело',
    duration: '20–30 мин',
    icon: Activity,
    steps: [
      '3–5 мин на минимальном сопротивлении',
      '15–20 мин в ровном темпе',
      'Последние 3–5 мин постепенно замедляйся',
    ],
    cue: 'Держи корпус вертикально и не переноси весь вес на рукоятки.',
  },
  {
    title: 'Быстрая прогулка',
    subtitle: 'Отдельное кардио без зала',
    duration: '30–45 мин',
    icon: Wind,
    steps: [
      'Первые 5 мин иди в обычном темпе',
      '20–35 мин шагай заметно быстрее обычного',
      'Последние 5 мин спокойно',
    ],
    cue: 'Для умеренного темпа: можешь разговаривать, но петь уже трудно.',
  },
]

const weekPlan = [
  { day: 'Пн', title: 'Тренировка A', detail: '+ 15–20 мин ходьбы под уклоном' },
  { day: 'Вт', title: 'Отдельное кардио', detail: '30–40 мин прогулки, велосипеда или эллипса' },
  { day: 'Ср', title: 'Тренировка B', detail: 'Только силовая; после неё — заминка 5–10 мин' },
  { day: 'Чт', title: 'Восстановление', detail: 'Спокойная прогулка, без обязательного кардио' },
  { day: 'Пт', title: 'Отдельное кардио', detail: '30–40 мин в умеренном темпе' },
  { day: 'Сб', title: 'Тренировка C', detail: '+ 15–20 мин лёгкого велосипеда по самочувствию' },
  { day: 'Вс', title: 'Отдых', detail: 'Прогулка без цели по темпу и времени' },
]

export function CardioPage() {
  const { user } = useAuth()
  return (
    <div className="page cardio-page">
      <Link className="back-link" to="/training"><ArrowLeft /> К тренировкам</Link>

      <header className="cardio-hero">
        <div className="cardio-hero-icon"><HeartPulse /></div>
        <p className="eyebrow">Кардио</p>
        <h1>Выносливость без помех силе</h1>
        <p>Начни с умеренного темпа. Кардио после силовой делай коротким, полноценные сессии — в отдельные дни.</p>
        <div className="cardio-targets" aria-label="Основные параметры кардио">
          <span><strong>2–3</strong> раза в неделю</span>
          <span><strong>20–40</strong> минут</span>
          <span><strong>5–6/10</strong> умеренное усилие</span>
        </div>
      </header>

      {user && <CardioJournal key={user.id} userId={user.id} />}

      <section className="section-block">
        <div className="section-heading">
          <div><p className="eyebrow">Когда делать</p><h2>План на неделю</h2></div>
        </div>
        <div className="cardio-week-list">
          {weekPlan.map((item) => (
            <article key={item.day}>
              <span>{item.day}</span>
              <div><strong>{item.title}</strong><small>{item.detail}</small></div>
            </article>
          ))}
        </div>
        <p className="cardio-note"><Timer /> Первые две недели достаточно двух кардиосессий. Затем добавь третью, если сон, пульс и силовые показатели не ухудшаются.</p>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div><p className="eyebrow">Что делать</p><h2>Кардио-упражнения</h2></div>
        </div>
        <div className="cardio-exercise-list">
          {cardioExercises.map(({ title, subtitle, duration, icon: Icon, steps, cue }) => (
            <article className="cardio-exercise-card" key={title}>
              <div className="cardio-exercise-head">
                <div className="cardio-exercise-icon"><Icon /></div>
                <div><h3>{title}</h3><p>{subtitle}</p></div>
                <span>{duration}</span>
              </div>
              <ol>{steps.map((step) => <li key={step}>{step}</li>)}</ol>
              <p className="cardio-cue"><Gauge /> {cue}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="cardio-intensity-card">
        <p className="eyebrow">Правильный темп</p>
        <h2>Ориентируйся на разговорный тест</h2>
        <p>При умеренном усилии можешь разговаривать, но петь уже трудно — обычно это 5–6/10. Если получается сказать только несколько слов до паузы на вдох, нагрузка уже интенсивная.</p>
        <div><CircleAlert /> После тяжёлой тренировки ног выбирай лёгкий велосипед, эллипс или перенеси кардио. При боли в груди, головокружении или необычной одышке остановись.</div>
      </section>
    </div>
  )
}
