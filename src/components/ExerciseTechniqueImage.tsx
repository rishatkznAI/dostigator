import { ArrowRight } from 'lucide-react'
import { getExerciseMedia } from '../lib/exercise-media'

type Props = {
  exerciseKey: string
  exerciseName: string
}

export function ExerciseTechniqueImage({ exerciseKey, exerciseName }: Props) {
  const media = getExerciseMedia(exerciseKey, exerciseName)
  if (!media) return null

  return (
    <figure className="technique-figure">
      <div className="technique-image-frame">
        <img
          src={media.src}
          alt={media.alt}
          loading="lazy"
          decoding="async"
        />
      </div>
      <figcaption>
        <span>{media.phaseLabels[0]}</span>
        <ArrowRight aria-hidden="true" />
        <span>{media.phaseLabels[1]}</span>
      </figcaption>
    </figure>
  )
}
