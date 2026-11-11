import { useSyncExternalStore } from 'react'
import { Clock3 } from 'lucide-react'
import type { Status } from '../../shared/types'
import { statusMetadata } from '../../shared/status'

// All visible counters share one clock; the rest of the board does not rerender
// each second, and ticking neither polls the API nor writes timer state.
let now = Date.now()
let interval: number | undefined
const listeners = new Set<() => void>()
const snapshot = () => now
const tick = () => {
  now = Date.now()
  listeners.forEach((listener) => listener())
}
const wake = () => {
  if (!document.hidden) tick()
}
function subscribe(listener: () => void) {
  if (!listeners.size) {
    now = Date.now()
    interval = window.setInterval(tick, 1000)
    window.addEventListener('focus', wake)
    document.addEventListener('visibilitychange', wake)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (!listeners.size) {
      window.clearInterval(interval)
      interval = undefined
      window.removeEventListener('focus', wake)
      document.removeEventListener('visibilitychange', wake)
    }
  }
}

function formatElapsed(seconds: number): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const minutes = Math.floor(seconds / 60) % 60
  const hours = Math.floor(seconds / 3600)
  const tail = `${pad(minutes)}:${pad(seconds % 60)}`
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${pad(hours % 24)}:${tail}`
  if (hours) return `${hours}:${tail}`
  return `${Math.floor(seconds / 60)}:${pad(seconds % 60)}`
}

export function TicketColumnTimer({ status, since }: { status: Status; since: string | null }) {
  if (status !== 'in_progress' && status !== 'ready_for_review') return null
  const label = statusMetadata[status].label
  const entered = Date.parse(since || '')
  if (!Number.isFinite(entered))
    return (
      <span
        className="ticket-column-timer unavailable-timer"
        aria-label={`${label} column time unavailable`}
        title="Column entry time is unavailable for this ticket. Earlier timing is not inferred from creation or update timestamps."
      >
        <Clock3 size={12} aria-hidden="true" />—
      </span>
    )
  return <KnownColumnTimer label={label} entered={entered} since={since!} />
}

function KnownColumnTimer({
  label,
  entered,
  since,
}: {
  label: string
  entered: number
  since: string
}) {
  const current = useSyncExternalStore(subscribe, snapshot)
  const seconds = Math.max(0, Math.floor((current - entered) / 1000))
  const elapsed = formatElapsed(seconds)
  return (
    <span
      className="ticket-column-timer"
      data-elapsed-seconds={seconds}
      data-status-since={since}
      aria-label={`Time in ${label}: ${elapsed}`}
      title={`${label} since ${new Date(entered).toLocaleString()}. Resets on each column move.`}
    >
      <Clock3 size={12} aria-hidden="true" />
      <time dateTime={`PT${seconds}S`}>{elapsed}</time>
    </span>
  )
}
