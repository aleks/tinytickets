import { CircleDot, Layers, Link2 } from 'lucide-react'
import type { Ticket, Workspace } from '../../shared/types'
import { TicketColumnTimer } from '../tickets/TicketColumnTimer'
import { selectUnfinishedBlockers } from '../workspace/selectors'

export function TicketCard({
  ticket,
  data,
  onClick,
  onDragEnd,
}: {
  ticket: Ticket
  data: Workspace
  onClick: () => void
  onDragEnd: () => void
}) {
  const epic = data.epics.find((e) => e.id === ticket.epic_id)
  const projectIndex = data.projects.findIndex((p) => p.id === epic?.project_id)
  const blockers = selectUnfinishedBlockers(
    ticket.id,
    data.links,
    new Map(data.tickets.map((t) => [t.id, t])),
  )
  const links = data.links.filter((l) => l.blocked_id === ticket.id || l.blocker_id === ticket.id)
  return (
    <button
      className="ticket-card"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-tinyticket', String(ticket.id))
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragEnd={onDragEnd}
      onClick={onClick}
    >
      <div className="ticket-card-top">
        <span className="ticket-id">TT-{ticket.id}</span>
        <span className="ticket-card-indicators">
          {blockers.length > 0 && (
            <span className="blocked-badge">
              <CircleDot size={10} />
              Blocked
            </span>
          )}
          <TicketColumnTimer status={ticket.status} since={ticket.status_since} />
        </span>
      </div>
      <h4>{ticket.title}</h4>
      {ticket.description && <p className="ticket-excerpt">{ticket.description}</p>}
      <div className="ticket-card-bottom">
        <span className={`epic-label color-${projectIndex % 5}`}>
          <Layers size={11} />
          <span className="truncate">{epic?.title}</span>
        </span>
        {links.length > 0 && (
          <span className="link-count" title={`${links.length} dependencies`}>
            <Link2 size={12} />
            {links.length}
          </span>
        )}
      </div>
    </button>
  )
}
