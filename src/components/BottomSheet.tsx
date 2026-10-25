import { visibleDialogControl } from '../lib/dialog-focus'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type PropsWithChildren } from 'react'

type Props = PropsWithChildren<{ title: string; busy?: boolean; onClose: () => void }>

export function BottomSheet({ title, busy = false, onClose, children }: Props) {
  const titleId = useId()
  const [closing, setClosing] = useState(false)
  const closingRef = useRef(false)
  const busyRef = useRef(busy)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const portalRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
    busyRef.current = busy
  }, [onClose, busy])

  const requestClose = () => {
    if (busyRef.current || closingRef.current) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { onCloseRef.current(); return }
    closingRef.current = true
    setClosing(true)
    closeTimer.current = setTimeout(() => {
      closingRef.current = false
      setClosing(false)
      if (!busyRef.current) onCloseRef.current()
    }, 160)
  }

  useEffect(() => {
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const background = Array.from(document.body.children).filter(element=>element!==portalRef.current) as HTMLElement[]
    const priorInert = background.map(element=>({element,inert:element.inert,attribute:element.hasAttribute('inert')}))
    background.forEach(element=>{element.inert=true;element.setAttribute('inert','')})
    const focusableSelector = 'summary, a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        requestClose()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return

      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector)).filter(visibleDialogControl)
      if (!focusable.length) {
        event.preventDefault()
        dialogRef.current.focus()
        return
      }

      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    if (busyRef.current) dialogRef.current?.focus({ preventScroll: true })
    else closeButtonRef.current?.focus({ preventScroll: true })
    window.addEventListener('keydown', handleKeyDown)
    document.body.classList.add('modal-open')
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      clearTimeout(closeTimer.current)
      document.body.classList.remove('modal-open')
      priorInert.forEach(({element,inert,attribute})=>{element.inert=inert;if(!attribute)element.removeAttribute('inert')})
      if (previousActiveElement?.isConnected) previousActiveElement.focus({ preventScroll: true })
    }
  }, [])

  useEffect(() => {
    if (busy) dialogRef.current?.focus({ preventScroll: true })
  }, [busy])

  return createPortal(
    <div className="training-module" ref={portalRef}><div className="sheet-backdrop" role="presentation" data-closing={closing} onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
      <section ref={dialogRef} className="bottom-sheet" role="dialog" aria-modal="true" aria-busy={busy} aria-labelledby={titleId} tabIndex={-1}>
        <div className="sheet-handle" aria-hidden="true" />
        <header>
          <h2 id={titleId}>{title}</h2>
          <button ref={closeButtonRef} className="icon-button" type="button" disabled={busy || closing} onClick={requestClose} aria-label="Закрыть">
            <X />
          </button>
        </header>
        <div className="sheet-content">{children}</div>
      </section>
    </div></div>, document.body,
  )
}
