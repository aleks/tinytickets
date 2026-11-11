import { lazy, Suspense, useState } from 'react'
import { Archive, ArchiveRestore, Check, Folder, Layers, Link2, Pencil, Plus } from 'lucide-react'
import { api, errorMessage, type Mutate } from '../../shared/api'
import { statuses as columns, isStatus } from '../../shared/status'
import type { Ticket, Workspace, UpdateTicketInput } from '../../shared/types'
import { viewHref } from '../../app/routing'
import { TicketWorkLog } from './TicketWorkLog'
const MarkdownDescription = lazy(() =>
  import('../markdown/MarkdownDescription').then((module) => ({
    default: module.MarkdownDescription,
  })),
)

export function TicketPage({
  ticket,
  data,
  revision,
  mutate,
  edit,
}: {
  ticket: Ticket
  data: Workspace
  revision: number
  mutate: Mutate
  edit: () => void
}) {
  const epic = data.epics.find((e) => e.id === ticket.epic_id)
  const project = data.projects.find((p) => p.id === epic?.project_id)
  const links = data.links.filter((l) => l.blocker_id === ticket.id || l.blocked_id === ticket.id)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function update(body: UpdateTicketInput) {
    setSaving(true)
    setError('')
    try {
      await mutate(api.updateTicket(ticket.id, body))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }
  async function restoreEpic() {
    if (!epic) return
    setSaving(true)
    setError('')
    try {
      await mutate(api.updateEpic(epic.id, { archived: false }))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="ticket-page">
      <div className="ticket-main">
        <article className="ticket-document" aria-label="Ticket description">
          <div className="ticket-context">
            {project && (
              <a href={viewHref({ type: 'project', id: project.id })}>
                <Folder size={14} />
                {project.name}
              </a>
            )}
            {epic && (
              <a href={viewHref({ type: 'epic', id: epic.id })}>
                <Layers size={14} />
                {epic.title}
              </a>
            )}
            {epic?.archived ? (
              <>
                <span className="badge">
                  <Archive size={11} />
                  Archived epic
                </span>
                <button className="text-button" disabled={saving} onClick={restoreEpic}>
                  <ArchiveRestore size={13} />
                  Unarchive epic
                </button>
              </>
            ) : (
              epic?.completed && (
                <span className="badge">
                  <Check size={11} />
                  Completed epic
                </span>
              )
            )}
          </div>
          <div className="section-heading">
            <h2>Description</h2>
            <button className="text-button" onClick={edit}>
              <Pencil size={13} />
              Edit
            </button>
          </div>
          {ticket.description.trim() ? (
            <Suspense
              fallback={
                <p className="muted" role="status">
                  Loading description…
                </p>
              }
            >
              <MarkdownDescription source={ticket.description} />
            </Suspense>
          ) : (
            <button className="empty-description" onClick={edit}>
              Add a description…
            </button>
          )}
        </article>
        <TicketWorkLog ticketID={ticket.id} revision={revision} mutate={mutate} />
      </div>
      <aside className="ticket-details" aria-label="Ticket details">
        <h2>Details</h2>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <label className="field-label">
          Status
          <select
            aria-label="Status"
            value={ticket.status}
            disabled={saving}
            onChange={(e) => {
              if (isStatus(e.target.value)) update({ status: e.target.value })
            }}
          >
            {columns.map((c) => (
              <option key={c.status} value={c.status}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label">
          Epic
          <select
            aria-label="Epic"
            value={ticket.epic_id}
            disabled={saving}
            onChange={(e) => update({ epic_id: Number(e.target.value) })}
          >
            {data.epics
              .filter((e) => !e.archived || e.id === ticket.epic_id)
              .map((e) => (
                <option key={e.id} value={e.id} disabled={e.archived}>
                  {data.projects.find((p) => p.id === e.project_id)?.name} / {e.title}
                  {e.archived ? ' (archived)' : e.completed ? ' (completed)' : ''}
                </option>
              ))}
          </select>
        </label>
        <dl className="ticket-metadata">
          <div>
            <dt>Project</dt>
            <dd>
              {project && (
                <a href={viewHref({ type: 'project', id: project.id })}>{project.name}</a>
              )}
            </dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>
              <time
                dateTime={ticket.created_at}
                title={new Date(ticket.created_at).toLocaleString()}
              >
                {new Date(ticket.created_at).toLocaleDateString()}
              </time>
            </dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>
              <time
                dateTime={ticket.updated_at}
                title={new Date(ticket.updated_at).toLocaleString()}
              >
                {new Date(ticket.updated_at).toLocaleString()}
              </time>
            </dd>
          </div>
        </dl>
        <section className="ticket-page-dependencies">
          <div className="section-heading">
            <h2>
              <Link2 size={14} />
              Dependencies<span className="count">{links.length}</span>
            </h2>
            <button className="icon-button" aria-label="Edit dependencies" onClick={edit}>
              <Plus size={14} />
            </button>
          </div>
          {links.map((link) => {
            const blockedBy = link.blocked_id === ticket.id
            const other = data.tickets.find(
              (t) => t.id === (blockedBy ? link.blocker_id : link.blocked_id),
            )
            return (
              other && (
                <a
                  className="ticket-related"
                  key={`${link.blocker_id}-${link.blocked_id}`}
                  href={viewHref({ type: 'ticket', id: other.id })}
                >
                  <span className="dependency-type">{blockedBy ? 'Blocked by' : 'Blocks'}</span>
                  <span className="ticket-related-title">
                    <span className="ticket-id">TT-{other.id}</span>
                    {other.title}
                    {other.status === 'done' && <Check size={12} />}
                  </span>
                </a>
              )
            )
          })}
          {!links.length && <span className="muted">No dependencies</span>}
        </section>
      </aside>
    </div>
  )
}
