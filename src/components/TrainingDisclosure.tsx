import { ChevronDown } from 'lucide-react'
import { useId, useState, type PropsWithChildren } from 'react'
import './training-disclosure.css'

type Props = PropsWithChildren<{ title: string; description?: string; className?: string; defaultOpen?: boolean }>

export function TrainingDisclosure({ title, description, className = '', defaultOpen = false, children }: Props) {
  const [expanded, setExpanded] = useState(defaultOpen)
  const id = useId()
  return <div className={`training-disclosure ${className}`} data-open={expanded}>
    <button className="training-disclosure-trigger" id={`${id}-trigger`} type="button" aria-labelledby={`${id}-title`} aria-describedby={description ? `${id}-description` : undefined} aria-expanded={expanded} aria-controls={`${id}-content`} onClick={event => {
      event.currentTarget.focus({ preventScroll: true })
      setExpanded(value => !value)
    }}>
      <span className="training-disclosure-copy"><strong className="training-disclosure-title" id={`${id}-title`}>{title}</strong>{description && <small id={`${id}-description`}>{description}</small>}</span>
      <span className="training-disclosure-cue" aria-hidden="true"><span>{expanded ? 'Свернуть' : 'Открыть'}</span><ChevronDown /></span>
    </button>
    <div className="training-disclosure-region" id={`${id}-content`} role="region" aria-labelledby={`${id}-trigger`} aria-hidden={!expanded} inert={!expanded}>
      <div className="training-disclosure-inner"><div className="training-disclosure-content">{children}</div></div>
    </div>
  </div>
}
