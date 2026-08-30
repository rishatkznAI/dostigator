import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces'
import type { WeeklyReportData } from '../types/training'
import { formatWeekRange, localDateKey, MEAL_TYPE_LABELS, summarizeWeek, weekDays, type MealType } from './week'

const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })
const dayTitle = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })
const time = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' })

const empty = { text: 'Нет записей', color: '#7b8276', italics: true, margin: [0, 3, 0, 7] } satisfies Content

function daySections(report: WeeklyReportData): Content[] {
  return weekDays(report.weekStart).flatMap((day) => {
    const key = localDateKey(day)
    const activity = report.activity.find((item) => item.activity_date === key)
    const meals = report.nutrition
      .filter((item) => localDateKey(new Date(item.eaten_at)) === key)
      .sort((a, b) => a.eaten_at.localeCompare(b.eaten_at))
    const workouts = report.workouts.filter((item) => localDateKey(new Date(item.finishedAt)) === key)
    const mealRows = meals.length ? meals.map((meal) => ({
      text: [
        { text: `${time.format(new Date(meal.eaten_at))}  ${MEAL_TYPE_LABELS[meal.meal_type as MealType] ?? 'Другое'}\n`, bold: true, color: '#1b2118' },
        { text: meal.description },
        ...(meal.calories !== null || meal.protein_g !== null
          ? [{ text: `\n${meal.calories !== null ? `${meal.calories} ккал` : ''}${meal.calories !== null && meal.protein_g !== null ? '  |  ' : ''}${meal.protein_g !== null ? `${number.format(meal.protein_g)} г белка` : ''}`, color: '#687061', fontSize: 8 }]
          : []),
      ],
      margin: [0, 3, 0, 5],
    } satisfies Content)) : [empty]
    const workoutRows = workouts.length ? workouts.map((workout) => ({
      text: `${workout.title}${workout.templateCode ? ` (${workout.templateCode})` : ''} - ${workout.durationMinutes} мин, ${workout.sets} подх., ${number.format(workout.volume)} кг${workout.averageRir !== null ? `, ср. RIR ${number.format(workout.averageRir)}` : ''}${workout.readinessMode === 'reduced' ? ', облегчённый режим' : ''}`,
      margin: [0, 2, 0, 4],
    } satisfies Content)) : [empty]

    return [
      { text: dayTitle.format(day), style: 'dayHeading', margin: [0, 14, 0, 5] },
      {
        table: {
          widths: [86, '*'],
          body: [
            [{ text: 'Шаги', style: 'rowLabel' }, { text: activity ? number.format(activity.steps) : 'Не указаны' }],
            [{ text: 'Тренировки', style: 'rowLabel' }, { stack: workoutRows }],
            [{ text: 'Питание', style: 'rowLabel' }, { stack: mealRows }],
          ],
        },
        layout: {
          hLineColor: '#dfe5d9',
          vLineColor: '#dfe5d9',
          paddingLeft: () => 8,
          paddingRight: () => 8,
          paddingTop: () => 6,
          paddingBottom: () => 6,
        },
      },
    ] satisfies Content[]
  })
}

export function buildWeeklyReportDocument(report: WeeklyReportData): TDocumentDefinitions {
  const summary = summarizeWeek(report)
  const calorieCopy = summary.calories ? number.format(summary.calories) : 'не указаны'
  const proteinCopy = summary.protein ? `${number.format(summary.protein)} г` : 'не указан'

  return {
    pageSize: 'A4',
    pageMargins: [36, 44, 36, 42],
    info: {
      title: `TrainLog - недельный отчёт ${localDateKey(report.weekStart)}`,
      author: 'TrainLog',
      subject: 'Питание, шаги и силовые тренировки за неделю',
    },
    defaultStyle: { font: 'Roboto', fontSize: 9.5, color: '#2d332a', lineHeight: 1.25 },
    footer: (currentPage, pageCount) => ({
      columns: [
        { text: 'TrainLog | данные пользователя', color: '#8b9284', fontSize: 8 },
        { text: `${currentPage} / ${pageCount}`, color: '#8b9284', fontSize: 8, alignment: 'right' },
      ],
      margin: [36, 10, 36, 0],
    }),
    content: [
      { text: 'TRAINLOG', color: '#78a814', bold: true, characterSpacing: 2.2, fontSize: 10 },
      { text: 'Недельный отчёт', style: 'title' },
      { text: formatWeekRange(report.weekStart, report.weekEndExclusive), color: '#697061', margin: [0, 0, 0, 16] },
      {
        columns: [
          { stack: [{ text: String(summary.score), style: 'metric' }, { text: 'оценка из 100', style: 'metricLabel' }] },
          { stack: [{ text: number.format(summary.averageSteps), style: 'metric' }, { text: `среднее (${summary.recordedDays} дн.)`, style: 'metricLabel' }] },
          { stack: [{ text: String(summary.workouts), style: 'metric' }, { text: 'тренировок', style: 'metricLabel' }] },
          { stack: [{ text: String(summary.totalSets), style: 'metric' }, { text: 'рабочих подходов', style: 'metricLabel' }] },
        ],
        columnGap: 7,
        margin: [0, 0, 0, 14],
      },
      {
        table: {
          widths: ['*', '*', '*', '*'],
          body: [[
            { text: `План A / B / C\n${summary.completedA ? '✓' : '—'} / ${summary.completedB ? '✓' : '—'} / ${summary.completedC ? '✓' : '—'}`, style: 'summaryCell' },
            { text: `Калории\n${calorieCopy}\nср. ${summary.averageCalories || '—'}`, style: 'summaryCell' },
            { text: `Белок\n${proteinCopy}\nср. ${summary.averageProtein || '—'} г`, style: 'summaryCell' },
            { text: `Алкоголь\n${summary.alcohol ? `${number.format(summary.alcohol)} порц.` : 'не записан'}`, style: 'summaryCell' },
          ]],
        },
        layout: { fillColor: '#f2f6ee', hLineWidth: () => 0, vLineWidth: () => 0 },
        margin: [0, 0, 0, 5],
      },
      {
        table: {
          widths: ['*', '*', '*'],
          body: [[
            { text: `Вес\n${summary.latestMeasurement?.weight_kg != null ? `${number.format(summary.latestMeasurement.weight_kg)} кг` : '—'}${summary.weightDelta !== null ? ` (${summary.weightDelta > 0 ? '+' : ''}${number.format(summary.weightDelta)} кг)` : ''}`, style: 'summaryCell' },
            { text: `Талия\n${summary.latestMeasurement?.waist_cm != null ? `${number.format(summary.latestMeasurement.waist_cm)} см` : '—'}${summary.waistDelta !== null ? ` (${summary.waistDelta > 0 ? '+' : ''}${number.format(summary.waistDelta)} см)` : ''}`, style: 'summaryCell' },
            { text: `Тренировочный объём\n${number.format(summary.totalVolume)} кг${summary.averageRir !== null ? `\nср. RIR ${number.format(summary.averageRir)}` : ''}`, style: 'summaryCell' },
          ]],
        },
        layout: { fillColor: '#f7f9f5', hLineWidth: () => 0, vLineWidth: () => 0 },
        margin: [0, 4, 0, 5],
      },
      ...daySections(report),
      { text: 'Что попросить у ИИ', style: 'sectionHeading', margin: [0, 14, 0, 8] },
      {
        text: 'Загрузите этот PDF и используйте запрос:',
        margin: [0, 0, 0, 6],
      },
      {
        text: 'Оцени мою неделю для цели рекомпозиции. Учти цель 9-10 тысяч шагов в день, обязательные тренировки A и B, дополнительную C, динамику веса и талии, тренировочный объём, средний RIR, облегчённые тренировки, ориентиры 2300-2400 ккал и 150-160 г белка, а также записанный алкоголь. Отдельно отметь сильные стороны, 2-3 главных улучшения на следующую неделю и не делай медицинских диагнозов. Если калории или белок не указаны, оцени только структуру и регулярность питания, не придумывая точные значения.',
        margin: [0, 0, 0, 14],
        fillColor: '#f2f6ee',
        color: '#293023',
      },
      { text: 'Важно', style: 'sectionHeading', margin: [0, 0, 0, 6] },
      { text: 'Отчёт содержит только внесённые данные. TrainLog не рассчитывает калории по тексту и не заменяет консультацию врача или диетолога.', color: '#697061' },
    ],
    styles: {
      title: { fontSize: 24, bold: true, color: '#171c15', margin: [0, 5, 0, 3] },
      metric: { fontSize: 17, bold: true, color: '#171c15', alignment: 'center', margin: [0, 8, 0, 2] },
      metricLabel: { fontSize: 7.5, color: '#737b6d', alignment: 'center', margin: [0, 0, 0, 8] },
      summaryCell: { alignment: 'center', bold: true, color: '#30372b', margin: [5, 8, 5, 8] },
      dayHeading: { fontSize: 13, bold: true, color: '#20261d' },
      rowLabel: { bold: true, color: '#647057', fillColor: '#f5f7f3' },
      sectionHeading: { fontSize: 15, bold: true, color: '#20261d' },
    },
  }
}

export function weeklyReportFilename(report: WeeklyReportData) {
  return `trainlog-week-${localDateKey(report.weekStart)}.pdf`
}

export async function downloadWeeklyReportPdf(report: WeeklyReportData) {
  const [{ default: pdfMake }, { default: pdfFonts }] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('pdfmake/build/vfs_fonts'),
  ])
  pdfMake.addVirtualFileSystem(pdfFonts)
  await pdfMake.createPdf(buildWeeklyReportDocument(report)).download(weeklyReportFilename(report))
}
