import { ArrowLeft, Bath, CircleAlert, Clock3, Droplets, Flame, GlassWater, HeartPulse, ShowerHead, Snowflake, Waves } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'

type SpaZone = {
  title: string
  subtitle: string
  time: string
  icon: LucideIcon
  steps: string[]
  note: string
}

const spaZones: SpaZone[] = [
  {
    title: 'Сауна',
    subtitle: 'Сухое тепло',
    time: '8–12 мин',
    icon: Flame,
    steps: [
      'Первый раз сядь на нижнюю или среднюю полку',
      'Дыши спокойно, не пытайся высидеть максимум',
      'Встань медленно и выйди при первых неприятных ощущениях',
    ],
    note: 'Начни с одного захода. Верхняя граница одного захода — 15 минут.',
  },
  {
    title: 'Хаммам',
    subtitle: 'Влажный пар',
    time: '5–10 мин',
    icon: Waves,
    steps: [
      'Выбери место подальше от выхода пара',
      'Сиди или лежи спокойно, без растяжки через боль',
      'Если дышать стало тяжело — сразу выйди',
    ],
    note: 'Высокая влажность мешает испарению пота, поэтому первый заход делай короче.',
  },
  {
    title: 'Джакузи',
    subtitle: 'Тёплая вода и расслабление',
    time: '10–15 мин',
    icon: Bath,
    steps: [
      'Сначала прими душ',
      'Проверь, что вода не горячее 40 °C',
      'Заходи и выходи медленно, держи голову над водой',
    ],
    note: 'Не используй джакузи после алкоголя и не оставайся, если кружится голова.',
  },
  {
    title: 'Бассейн',
    subtitle: 'Активное восстановление',
    time: '5–10 мин',
    icon: Droplets,
    steps: [
      'Пройдись в воде или спокойно проплыви несколько дорожек',
      'Не считай темп и не делай интервалы',
      'Заверши до появления усталости',
    ],
    note: 'Это заминка, а не вторая тренировка.',
  },
]

const recoverySteps = [
  { time: '0–10', title: 'Спокойная заминка', detail: '5–10 минут лёгкой ходьбы. Дождись, пока дыхание и пульс заметно успокоятся.', icon: HeartPulse },
  { time: '10–13', title: 'Душ и вода', detail: 'Смой пот и выпей немного воды небольшими глотками.', icon: ShowerHead },
  { time: '13–25', title: 'Один заход в тепло', detail: 'Выбери только сауну, хаммам или джакузи по инструкции ниже.', icon: Flame },
  { time: '25–35', title: 'Постепенное охлаждение', detail: 'Посиди 5–10 минут, затем прими прохладный или тёплый душ.', icon: Waves },
  { time: 'после', title: 'Восстановление жидкости', detail: 'Продолжай пить по жажде и поешь обычную еду с солью и белком.', icon: GlassWater },
]

const skipReasons = [
  'головокружение, тошнота, озноб или сильная головная боль',
  'необычная одышка, боль в груди или ощущение перебоев в сердце',
  'явное обезвоживание: сильная жажда, сухость во рту, очень тёмная моча',
  'болезнь, температура, алкоголь или очень плохое самочувствие',
]

export function SpaPage() {
  return (
    <div className="page spa-page">
      <Link className="back-link" to="/training"><ArrowLeft /> К тренировкам</Link>

      <header className="spa-hero">
        <div className="spa-hero-icon"><Waves /></div>
        <p className="eyebrow">Спа после тренировки</p>
        <h1>Расслабление, а не ещё одна нагрузка</h1>
        <p>Главное правило — сначала восстановить спокойное дыхание и только потом идти в тепло. В первый месяц достаточно одного короткого захода.</p>
        <div className="spa-targets" aria-label="Основные параметры спа">
          <span><strong>5–10</strong> мин заминка</span>
          <span><strong>1</strong> заход сначала</span>
          <span><strong>25–35</strong> мин весь ритуал</span>
        </div>
      </header>

      <section className="section-block">
        <div className="section-heading">
          <div><p className="eyebrow">Базовый вариант</p><h2>Порядок действий</h2></div>
        </div>
        <div className="spa-timeline">
          {recoverySteps.map(({ time, title, detail, icon: Icon }, index) => (
            <article key={title}>
              <div className="spa-time"><span>{String(index + 1).padStart(2, '0')}</span><small>{time === 'после' ? time : `${time} мин`}</small></div>
              <div className="spa-timeline-icon"><Icon /></div>
              <div><strong>{title}</strong><p>{detail}</p></div>
            </article>
          ))}
        </div>
        <p className="spa-note"><Clock3 /> Второй заход добавляй только после нескольких недель хорошей переносимости: 5–8 минут тепла после полноценного отдыха между заходами.</p>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div><p className="eyebrow">Выбери одно</p><h2>Спа-зоны</h2></div>
        </div>
        <div className="spa-zone-list">
          {spaZones.map(({ title, subtitle, time, icon: Icon, steps, note }) => (
            <article className="spa-zone-card" key={title}>
              <div className="spa-zone-head">
                <div className="spa-zone-icon"><Icon /></div>
                <div><h3>{title}</h3><p>{subtitle}</p></div>
                <span>{time}</span>
              </div>
              <ol>{steps.map((step) => <li key={step}>{step}</li>)}</ol>
              <p className="spa-zone-note">{note}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="cold-card">
        <div className="cold-card-icon"><Snowflake /></div>
        <div>
          <p className="eyebrow">Холод после силовой</p>
          <h2>Прохладный душ — можно. Ледяная ванна — не регулярно</h2>
          <p>Для вашей цели — сохранить и нарастить мышцы — не делай ледяное погружение привычным финалом каждой силовой. Если холод нравится, перенеси его на отдельное время или день.</p>
        </div>
      </section>

      <section className="section-block spa-hydration-card">
        <div className="spa-hydration-icon"><GlassWater /></div>
        <div>
          <p className="eyebrow">Вода</p>
          <h2>Восполни то, что потерял с потом</h2>
          <p>Не нужно выпивать литр залпом. Пей постепенно. Если взвешиваешься до и после тренировки, каждые потерянные 0,5 кг — ориентир примерно на 0,5–0,75 л жидкости в следующие несколько часов.</p>
        </div>
      </section>

      <section className="spa-stop-card">
        <p className="eyebrow">Когда пропустить</p>
        <h2>Не заходи в тепло через силу</h2>
        <ul>{skipReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        <div><CircleAlert /> При сердечно-сосудистых заболеваниях, неконтролируемом давлении, обмороках, беременности или приёме лекарств, влияющих на давление и потоотделение, сначала согласуй горячие процедуры с врачом.</div>
      </section>
    </div>
  )
}
