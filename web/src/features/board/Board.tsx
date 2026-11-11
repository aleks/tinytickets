import { Plus, Ticket as TicketIcon } from 'lucide-react'
import { statuses as columns } from '../../shared/status'
import type { Epic, Status, Ticket, Workspace } from '../../shared/types'
import { SearchField } from '../../shared/ui/SearchField'
import { TicketCard } from './TicketCard'
import type { Dialog } from '../editor/dialog'

export function Board({
  visibleTickets,
  query,
  setQuery,
  dragOver,
  setDragOver,
  move,
  currentEpic,
  newTicket,
  data,
  setDialog,
  activeCount,
}: {
  visibleTickets: Ticket[]
  query: string
  setQuery: (query: string) => void
  dragOver: Status | null
  setDragOver: (status: Status | null) => void
  move: (id: number, status: Status) => void
  currentEpic: Epic | undefined
  newTicket: (status?: Status) => void
  data: Workspace
  setDialog: (dialog: Dialog) => void
  activeCount: number
}) {
  return (
    <section className="board-section">
      <div className="section-heading board-heading">
        <h2>
          <TicketIcon size={17} />
          Tickets<span className="count">{visibleTickets.length}</span>
        </h2>
        <div className="board-tools">
          <SearchField value={query} onChange={setQuery} placeholder="Search tickets…" />
          <span className="board-view-label">
            <span className="board-symbol">▥</span>Board
          </span>
        </div>
      </div>
      <div className="board">
        {columns.map(({ status, label, icon: Icon }) => {
          const tickets = visibleTickets.filter((t) => t.status === status)
          return (
            <section
              key={status}
              className={`column column-${status} ${dragOver === status ? 'drag-over' : ''}`}
              aria-label={label}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes('application/x-tinyticket')) {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  setDragOver(status)
                }
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null)
              }}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(null)
                move(Number(e.dataTransfer.getData('application/x-tinyticket')), status)
              }}
            >
              <div className="column-heading">
                <Icon size={15} />
                <h3>{label}</h3>
                <span className="column-count">{tickets.length}</span>
                {!currentEpic?.archived && (
                  <button
                    className="icon-button"
                    aria-label={`New ticket in ${label}`}
                    onClick={() => newTicket(status)}
                  >
                    <Plus size={15} />
                  </button>
                )}
              </div>
              <div className="column-cards">
                {tickets.map((ticket) => (
                  <TicketCard
                    key={ticket.id}
                    ticket={ticket}
                    data={data}
                    onClick={() => setDialog({ type: 'ticket', item: ticket })}
                    onDragEnd={() => setDragOver(null)}
                  />
                ))}
                {!currentEpic?.archived && (
                  <button className="add-ticket" onClick={() => newTicket(status)}>
                    <Plus size={14} />
                    Add ticket
                  </button>
                )}
                {!tickets.length && (
                  <div className="empty-column">{query ? 'No matches' : 'No tickets'}</div>
                )}
              </div>
            </section>
          )
        })}
      </div>
      <div className="board-footer">
        <span>
          {activeCount} active {activeCount === 1 ? 'epic' : 'epics'}
          <span className="footer-dot">·</span>
          {visibleTickets.filter((t) => t.status === 'done').length} of {visibleTickets.length}{' '}
          tickets done
        </span>
        <span>Drag tickets to move between columns</span>
      </div>
    </section>
  )
}
