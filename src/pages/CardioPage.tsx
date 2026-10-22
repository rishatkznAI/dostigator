import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getActiveDraft } from '../lib/storage'
import { CardioJournal } from '../components/CardioJournal'

export function CardioPage() {
  const { user } = useAuth()
  const active=user?getActiveDraft(user.id):null
  return <div className="page cardio-page focused-cardio-page"><Link className="back-link" to={active?`/training/workout/${active.templateCode}`:'/training'}><ArrowLeft />{active?'Вернуться к силовой':'К тренировкам'}</Link><header className="training-page-title"><p className="eyebrow">Тренировка</p><h1>Кардио</h1></header>{user && <CardioJournal key={user.id} userId={user.id} />}<details className="training-extras cardio-reference"><summary>Темп и безопасность</summary><p>Для умеренного кардио можно говорить фразами, но петь трудно. Разговорный тест — необязательный ориентир во время занятия, не анкета для записи.</p><p>Постепенно разогревайся и замедляйся в конце, обычно по 5–10 минут. При боли в груди, головокружении или необычной одышке остановись; при выраженных или не проходящих симптомах нужна срочная медицинская помощь. Ограничения врача важнее цели приложения.</p><p>Общий ориентир для взрослых — 150 минут умеренной или 75 минут интенсивной активности за неделю, либо их сочетание. Начинать можно с меньшего объёма; лёгкие минуты не считаются автоматически умеренными.</p><div className="cardio-source-links"><a href="https://www.cdc.gov/physical-activity-basics/measuring/index.html" target="_blank" rel="noreferrer">Интенсивность · CDC</a><a href="https://www.cdc.gov/physical-activity-basics/guidelines/adults.html" target="_blank" rel="noreferrer">Недельный объём · CDC</a><a href="https://www.heart.org/en/healthy-living/exercise-and-physical-activity/fitness-basics/warm-up-cool-down" target="_blank" rel="noreferrer">Разминка и заминка · AHA</a></div></details></div>
}
