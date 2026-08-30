import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { WeightGuide } from '../src/components/WeightGuide'
import { EXERCISE_IMAGE_FILES } from '../src/lib/exercise-media'
import { EXERCISE_WEIGHT_GUIDES, getExerciseWeightGuide } from '../src/lib/weight-guide'

describe('personal starting weight guides', () => {
  it('covers every exercise in the current library', () => {
    expect(Object.keys(EXERCISE_WEIGHT_GUIDES).sort()).toEqual(Object.keys(EXERCISE_IMAGE_FILES).sort())
  })

  it('returns conservative options and safely handles an unknown exercise', () => {
    expect(getExerciseWeightGuide('chest_press')).toMatchObject({ light: '20 кг', working: '35 кг', tryNext: '45 кг' })
    expect(getExerciseWeightGuide('rdl')).toMatchObject({ light: '12 кг', working: '18 кг', tryNext: '24 кг' })
    expect(getExerciseWeightGuide('unknown_exercise')).toBeNull()
  })

  it('explains how to advance from light to working weight', () => {
    render(<WeightGuide guide={EXERCISE_WEIGHT_GUIDES.incline_db_press} />)
    expect(screen.getByText('Лайт')).toBeInTheDocument()
    expect(screen.getByText('Рабочий')).toBeInTheDocument()
    expect(screen.getByText('Попробовать')).toBeInTheDocument()
    expect(screen.getByText(/запасе ≥4 RIR/)).toBeInTheDocument()
  })
})
