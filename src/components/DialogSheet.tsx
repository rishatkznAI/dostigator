import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

const focusableSelector = [
  'button:not([disabled]):not([tabindex="-1"])',
  'input:not([disabled]):not([type="hidden"]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  '[href]:not([tabindex="-1"])',
  '[contenteditable="true"]:not([tabindex="-1"])',
].join(', ')

export function DialogSheet({
  titleId, eyebrow, title, busy, dirty, onClose, children,
}: {
  titleId: string
  eyebrow: string
  title: string
  busy: boolean
  dirty: boolean
  onClose(): void
  children: ReactNode
}) {
  const sheetRef = useRef<HTMLElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const openerRef = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  const requestClose = () => {
    if (busy) return
    if (dirty && !window.confirm('Закрыть без сохранения изменений?')) return
    onClose()
  }
  const requestCloseRef = useRef(requestClose)

  useLayoutEffect(() => {
    requestCloseRef.current = requestClose
  })

  useLayoutEffect(() => {
    const backdrop = backdropRef.current
    const sheet = sheetRef.current
    const opener = openerRef.current
    if (!backdrop || !sheet) return

    const background = Array.from(document.body.children).filter((element) => element !== backdrop) as HTMLElement[]
    const previousInert = background.map((element) => ({ element, inert: element.inert, hadAttribute: element.hasAttribute('inert') }))
    const previousOverflow = document.body.style.overflow
    background.forEach((element) => {
      element.inert = true
      element.setAttribute('inert', '')
    })
    document.body.style.overflow = 'hidden'

    const preferredFocus = sheet.querySelector<HTMLElement>('[data-dialog-initial-focus]:not([disabled])')
    const firstFocus = sheet.querySelector<HTMLElement>(focusableSelector)
    if (!sheet.contains(document.activeElement)) (preferredFocus ?? firstFocus ?? sheet).focus()

    const onDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        requestCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const controls = Array.from(sheet.querySelectorAll<HTMLElement>(focusableSelector))
      if (controls.length === 0) {
        event.preventDefault()
        sheet.focus()
        return
      }
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === sheet)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onDocumentKeyDown)
    return () => {
      document.removeEventListener('keydown', onDocumentKeyDown)
      previousInert.forEach(({ element, inert, hadAttribute }) => {
        element.inert = inert
        if (hadAttribute) element.setAttribute('inert', '')
        else element.removeAttribute('inert')
      })
      document.body.style.overflow = previousOverflow
      if (opener?.isConnected) opener.focus()
    }
  }, [])

  useLayoutEffect(() => {
    if (busy) sheetRef.current?.focus()
  }, [busy])

  return createPortal(
    <div
      ref={backdropRef}
      className="sheet-backdrop"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose() }}
    >
      <section
        ref={sheetRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy}
        tabIndex={-1}
      >
        <div className="sheet-handle" aria-hidden="true" />
        <button className="icon-button sheet-close" type="button" disabled={busy} onClick={requestClose} aria-label="Закрыть"><X /></button>
        <p className="eyebrow">{eyebrow}</p>
        <h2 id={titleId}>{title}</h2>
        {busy && <p className="visually-hidden" role="status" aria-live="polite">Идёт сохранение, дождитесь завершения.</p>}
        {children}
      </section>
    </div>,
    document.body,
  )
}
