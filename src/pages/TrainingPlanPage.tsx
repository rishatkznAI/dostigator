import { useState } from 'react'
import { NutritionJournal } from '../components/NutritionJournal'
import { NutritionPlan } from '../components/NutritionPlan'
import { WeeklyReportView } from '../components/WeeklyReportView'

type NutritionTab = 'journal' | 'report' | 'plan'

export function TrainingPlanPage() {
  const [tab, setTab] = useState<NutritionTab>('journal')

  return (
    <div className="page plan-page">
      <header className="page-header">
        <p className="eyebrow">Питание и активность</p>
        <h1>{tab === 'journal' ? 'Сегодня' : tab === 'report' ? 'Моя неделя' : 'Рекомпозиция'}</h1>
        <p>{tab === 'journal' ? 'Записывайте еду обычными словами и добавляйте шаги за день.' : tab === 'report' ? 'Соберите питание, шаги и тренировки в один PDF.' : 'Снижаем жировую массу без жёсткой сушки и сохраняем силу. Первый этап — с 96 до 90 кг.'}</p>
      </header>

      <nav className="nutrition-tabs" aria-label="Разделы питания">
        <button type="button" className={tab === 'journal' ? 'active' : ''} aria-pressed={tab === 'journal'} onClick={() => setTab('journal')}>Дневник</button>
        <button type="button" className={tab === 'report' ? 'active' : ''} aria-pressed={tab === 'report'} onClick={() => setTab('report')}>Отчёт</button>
        <button type="button" className={tab === 'plan' ? 'active' : ''} aria-pressed={tab === 'plan'} onClick={() => setTab('plan')}>План</button>
      </nav>

      {tab === 'journal' && <NutritionJournal />}
      {tab === 'report' && <WeeklyReportView />}
      {tab === 'plan' && <NutritionPlan />}
    </div>
  )
}
