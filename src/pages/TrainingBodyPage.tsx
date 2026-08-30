import { Camera, Plus, Ruler, Scale } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useAuth } from '../context/AuthContext'
import { LineChart } from '../components/LineChart'
import { getProgressPhotoUrl, loadMeasurements, saveMeasurement, uploadProgressPhoto } from '../lib/trainingRepository'
import { createId, formatNumber } from '../lib/workout'
import type { BodyMeasurement } from '../types/training'

const today = () => new Date().toISOString().slice(0, 10)
const shortDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' })

function ProgressPhotos({ measurement }: { measurement?: BodyMeasurement }) {
  const [urls, setUrls] = useState<Array<{ label: string; url: string }>>([])
  useEffect(() => {
    let active = true
    const paths = [
      ['Спереди', measurement?.photo_front_path],
      ['Сбоку', measurement?.photo_side_path],
      ['Сзади', measurement?.photo_back_path],
    ].filter((item): item is [string, string] => !!item[1])
    void Promise.all(paths.map(async ([label, path]) => ({ label, url: await getProgressPhotoUrl(path) })))
      .then((items) => { if (active) setUrls(items) })
      .catch(() => { if (active) setUrls([]) })
    return () => { active = false }
  }, [measurement])
  if (!urls.length) return null
  return <section className="progress-photos"><div className="section-heading"><div><p className="eyebrow">Приватно</p><h2>Последняя фототочка</h2></div></div><div>{urls.map((item) => <figure key={item.label}><img src={item.url} alt={`Прогресс: ${item.label.toLowerCase()}`} /><figcaption>{item.label}</figcaption></figure>)}</div></section>
}

export function TrainingBodyPage() {
  const { user } = useAuth()
  const [measurements, setMeasurements] = useState<BodyMeasurement[]>([])
  const [date, setDate] = useState(today())
  const [weight, setWeight] = useState('')
  const [waist, setWaist] = useState('')
  const [chest, setChest] = useState('')
  const [frontPhoto, setFrontPhoto] = useState<File | null>(null)
  const [sidePhoto, setSidePhoto] = useState<File | null>(null)
  const [backPhoto, setBackPhoto] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [referenceNow, setReferenceNow] = useState(0)

  const refresh = () => loadMeasurements().then((items) => {
    setMeasurements(items)
    setReferenceNow(Date.now())
  })
  useEffect(() => {
    void refresh().catch((reason: Error) => setMessage(reason.message))
  }, [])
  const chronological = useMemo(() => [...measurements].reverse(), [measurements])
  const latestWithPhotos = measurements.find((item) => item.photo_front_path || item.photo_side_path || item.photo_back_path)
  const latestWeight = measurements.find((item) => item.weight_kg !== null)?.weight_kg ?? null
  const latestWaist = measurements.find((item) => item.waist_cm !== null)?.waist_cm ?? null
  const latestChest = measurements.find((item) => item.chest_cm !== null)?.chest_cm ?? null
  const recentWeights = measurements.filter((item) => item.weight_kg !== null && referenceNow - new Date(item.measured_at).getTime() <= 7 * 86_400_000)
  const weeklyAverage = recentWeights.length ? recentWeights.reduce((sum, item) => sum + item.weight_kg!, 0) / recentWeights.length : null

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!weight && !waist && !chest && !frontPhoto && !sidePhoto && !backPhoto) {
      setMessage('Укажи замер или добавь фото')
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      if (!user) throw new Error('Сессия входа завершилась')
      const measuredAt = new Date(`${date}T12:00:00`).toISOString()
      const [photoFrontPath, photoSidePath, photoBackPath] = await Promise.all([
        frontPhoto ? uploadProgressPhoto(user.id, date, 'front', frontPhoto) : Promise.resolve(null),
        sidePhoto ? uploadProgressPhoto(user.id, date, 'side', sidePhoto) : Promise.resolve(null),
        backPhoto ? uploadProgressPhoto(user.id, date, 'back', backPhoto) : Promise.resolve(null),
      ])
      await saveMeasurement({
        id: createId(),
        measuredAt,
        weightKg: weight ? Number(weight) : null,
        waistCm: waist ? Number(waist) : null,
        chestCm: chest ? Number(chest) : null,
        photoFrontPath,
        photoSidePath,
        photoBackPath,
      })
      setWeight('')
      setWaist('')
      setChest('')
      setFrontPhoto(null); setSidePhoto(null); setBackPhoto(null)
      setMessage('Замер сохранён')
      await refresh()
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page">
      <header className="page-header"><p className="eyebrow">Вне зала</p><h1>Замеры</h1><p>Вес — ориентир. Тренд важнее одной цифры.</p></header>
      <div className="body-current three-metrics">
        <div><Scale /><span>Вес · ср. 7 дней</span><strong>{weeklyAverage !== null ? `${formatNumber(weeklyAverage)} кг` : latestWeight ? `${formatNumber(latestWeight)} кг` : '—'}</strong></div>
        <div><Ruler /><span>Талия</span><strong>{latestWaist ? `${formatNumber(latestWaist)} см` : '—'}</strong></div>
        <div><Ruler /><span>Грудь</span><strong>{latestChest ? `${formatNumber(latestChest)} см` : '—'}</strong></div>
      </div>
      <form className="measurement-form" onSubmit={submit}>
        <div className="form-heading"><div><p className="eyebrow">Новая точка</p><h2>Добавить замер</h2></div><Plus /></div>
        <label>Дата<input type="date" value={date} max={today()} onChange={(event) => setDate(event.target.value)} required /></label>
        <div className="form-row">
          <label>Вес, кг<input aria-label="Вес, кг" type="number" inputMode="decimal" min="1" max="500" step="0.1" placeholder="78.4" value={weight} onChange={(event) => setWeight(event.target.value)} /></label>
          <label>Талия, см<input aria-label="Талия, см" type="number" inputMode="decimal" min="1" max="300" step="0.1" placeholder="82" value={waist} onChange={(event) => setWaist(event.target.value)} /></label>
          <label>Грудь, см<input aria-label="Грудь, см" type="number" inputMode="decimal" min="1" max="300" step="0.1" placeholder="108" value={chest} onChange={(event) => setChest(event.target.value)} /></label>
        </div>
        <fieldset className="photo-inputs"><legend><Camera />Фото прогресса · необязательно</legend><p>JPEG/PNG/WebP до 5 МБ. Фото хранятся в закрытом разделе Supabase.</p><div>
          <label>Спереди<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setFrontPhoto(event.target.files?.[0] ?? null)} /><span>{frontPhoto?.name ?? 'Выбрать'}</span></label>
          <label>Сбоку<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setSidePhoto(event.target.files?.[0] ?? null)} /><span>{sidePhoto?.name ?? 'Выбрать'}</span></label>
          <label>Сзади<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setBackPhoto(event.target.files?.[0] ?? null)} /><span>{backPhoto?.name ?? 'Выбрать'}</span></label>
        </div></fieldset>
        {message && <p className="form-message" role="status">{message}</p>}
        <button className="primary-button wide" type="submit" disabled={saving}>{saving ? 'Сохраняем…' : 'Сохранить замер'}</button>
      </form>
      <section className="chart-card">
        <div className="chart-heading"><div><span>Вес</span><strong>{chronological.length} записей</strong></div></div>
        <LineChart points={chronological.filter((item) => item.weight_kg !== null).map((item) => ({ label: shortDate.format(new Date(item.measured_at)), value: item.weight_kg! }))} unit="кг" />
      </section>
      <section className="chart-card">
        <div className="chart-heading"><div><span>Грудь</span><strong>{chronological.filter((item) => item.chest_cm !== null).length} записей</strong></div></div>
        <LineChart points={chronological.filter((item) => item.chest_cm !== null).map((item) => ({ label: shortDate.format(new Date(item.measured_at)), value: item.chest_cm! }))} unit="см" />
      </section>
      <ProgressPhotos measurement={latestWithPhotos} />
      <section className="chart-card">
        <div className="chart-heading"><div><span>Талия</span><strong>{chronological.filter((item) => item.waist_cm !== null).length} записей</strong></div></div>
        <LineChart points={chronological.filter((item) => item.waist_cm !== null).map((item) => ({ label: shortDate.format(new Date(item.measured_at)), value: item.waist_cm! }))} unit="см" />
      </section>
    </div>
  )
}
