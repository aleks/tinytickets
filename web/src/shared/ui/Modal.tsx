import { useEffect, useRef, type ReactNode } from 'react'

export function Modal({
  className,
  labelledBy,
  saving,
  changed,
  close,
  children,
}: {
  className: string
  labelledBy: string
  saving: boolean
  changed: boolean
  close: () => void
  children: (requestClose: () => void) => ReactNode
}) {
  const modal = useRef<HTMLDivElement>(null)
  const requestClose = () => {
    if (!saving && (!changed || confirm('Discard unsaved changes?'))) close()
  }
  const closeRef = useRef(requestClose)
  closeRef.current = requestClose

  useEffect(() => {
    const previous = document.activeElement as HTMLElement
    modal.current?.querySelector<HTMLInputElement>('input')?.focus()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeRef.current()
      }
      if (e.key === 'Tab') {
        const controls = modal.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled), input, textarea, select, [tabindex="0"]',
        )
        if (!controls?.length) return
        const first = controls[0],
          last = controls[controls.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('keydown', key)
      previous?.focus()
    }
  }, [])

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose()
      }}
    >
      <div
        className={className}
        ref={modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
      >
        {children(requestClose)}
      </div>
    </div>
  )
}
