import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WeeklyReportView } from '../src/components/WeeklyReportView'
import { getWeekRange } from '../src/lib/week'
import type { WeeklyReportData } from '../src/types/training'

const mocks = vi.hoisted(() => ({
  loadWeeklyReport: vi.fn(),
  downloadWeeklyReportPdf: vi.fn(),
}))

vi.mock('../src/lib/trainingRepository', () => ({ loadWeeklyReport: mocks.loadWeeklyReport }))
vi.mock('../src/lib/weekly-report-pdf', () => ({ downloadWeeklyReportPdf: mocks.downloadWeeklyReportPdf }))

const range = getWeekRange(new Date())
const report: WeeklyReportData = {
  ...range,
  nutrition: [],
  activity: [{
    id: 'activity', user_id: 'user', activity_date: range.weekStart.toLocaleDateString('en-CA'), steps: 8800,
    note: '', created_at: '', updated_at: '',
  }],
  workouts: [],
  measurements: [],
}

describe('weekly report view', () => {
  beforeEach(() => {
    mocks.loadWeeklyReport.mockReset().mockResolvedValue(report)
    mocks.downloadWeeklyReportPdf.mockReset().mockResolvedValue(undefined)
  })

  it('shows the collected week and downloads the generated PDF', async () => {
    render(<WeeklyReportView />)
    expect(await screen.findByText('8 800')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Скачать PDF-отчёт' }))
    await waitFor(() => expect(mocks.downloadWeeklyReportPdf).toHaveBeenCalledWith(report))
  })

  it('retries a failed report load', async () => {
    mocks.loadWeeklyReport.mockRejectedValueOnce(new Error('Нет сети')).mockResolvedValueOnce(report)
    render(<WeeklyReportView />)
    expect(await screen.findByText('Нет сети')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(await screen.findByRole('button', { name: 'Скачать PDF-отчёт' })).toBeInTheDocument()
    expect(mocks.loadWeeklyReport).toHaveBeenCalledTimes(2)
  })
})
