import { useEffect, useRef, type ReactNode } from 'react'

export function Modal({
  className,
  labelledBy,
  saving,
  changed,
  close,
  children,
  initialFocus,
}: {
  className: string
  labelledBy: string
  saving: boolean
  changed: boolean
  close: () => void
  children: (requestClose: () => void) => ReactNode
  initialFocus?: string
}) {
  const modal = useRef<HTMLDivElement>(null)
  const requestClose = () => {
    if (!saving && (!changed || confirm('Discard unsaved changes?'))) close()
  }
  const closeRef = useRef(requestClose)
  closeRef.current = requestClose

  useEffect(() => {
    const previous = document.activeElement as HTMLElement
    modal.current?.querySelector<HTMLElement>(initialFocus || 'input')?.focus()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeRef.current()
      }
      if (e.key === 'Tab') {
        const controls = modal.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
        )
        if (!controls?.length) {
          e.preventDefault()
          modal.current?.focus()
          return
        }
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
  }, [initialFocus])

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
        tabIndex={-1}
      >
        {children(requestClose)}
      </div>
    </div>
  )
}
