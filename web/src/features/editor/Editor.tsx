import { useRef, useState } from 'react'
import {
  ArrowUpRight,
  Check,
  Folder,
  Layers,
  Link2,
  LoaderCircle,
  Plus,
  Ticket as TicketIcon,
  Trash2,
  X,
} from 'lucide-react'
import { api, errorMessage, type Mutate } from '../../shared/api'
import type { Status, Ticket, Link, Workspace } from '../../shared/types'
import { viewHref } from '../../app/routing'
import type { Dialog } from './dialog'
import { Modal } from '../../shared/ui/Modal'
import { EpicFields } from '../projects/EpicFields'
import { TicketFields } from '../tickets/TicketFields'

export function Editor({
  dialog,
  data,
  mutate,
  close,
  openTicket,
  openPage,
}: {
  dialog: Dialog
  data: Workspace
  mutate: Mutate
  close: () => void
  openTicket: (t: Ticket) => void
  openPage: (t: Ticket) => void
}) {
  const item = dialog.item
  const isTicket = dialog.type === 'ticket'
  const liveTicket = isTicket && item ? data.tickets.find((t) => t.id === item.id) : undefined
  const [title, setTitle] = useState(item ? ('name' in item ? item.name : item.title) : '')
  const [description, setDescription] = useState(
    isTicket && dialog.item ? dialog.item.description : '',
  )
  const [projectId, setProjectId] = useState(
    dialog.type === 'epic'
      ? dialog.item?.project_id || dialog.projectId || data.projects[0]?.id || 0
      : 0,
  )
  const [epicId, setEpicId] = useState(
    isTicket
      ? dialog.item?.epic_id ||
          dialog.epicId ||
          data.epics.find((e) => !e.archived && !e.completed)?.id ||
          data.epics.find((e) => !e.archived)?.id ||
          0
      : 0,
  )
  const [status, setStatus] = useState<Status>(
    isTicket ? dialog.item?.status || dialog.status || 'todo' : 'todo',
  )
  const [completed, setCompleted] = useState(
    dialog.type === 'epic' ? dialog.item?.completed || false : false,
  )
  const [archived, setArchived] = useState(
    dialog.type === 'epic' ? dialog.item?.archived || false : false,
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [relation, setRelation] = useState('blocked_by')
  const [target, setTarget] = useState('')
  const initial = useRef({ title, description, projectId, epicId, status, completed, archived })
  const changed =
    JSON.stringify(initial.current) !==
    JSON.stringify({ title, description, projectId, epicId, status, completed, archived })
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    setError('')
    try {
      // Do not overwrite unrelated changes made by another user or agent.
      const before = initial.current
      if (dialog.type === 'project') {
        const body = { name: title }
        await mutate(
          item
            ? api.updateProject(item.id, changedFields(body, { name: before.title }))
            : api.createProject(body),
        )
      } else if (dialog.type === 'epic') {
        const body = { title, project_id: projectId, completed, archived }
        await mutate(
          item
            ? api.updateEpic(
                item.id,
                changedFields(body, {
                  title: before.title,
                  project_id: before.projectId,
                  completed: before.completed,
                  archived: before.archived,
                }),
              )
            : api.createEpic(body),
        )
      } else {
        const body = { title, description, epic_id: epicId, status }
        await mutate(
          item
            ? api.updateTicket(
                item.id,
                changedFields(body, {
                  title: before.title,
                  description: before.description,
                  epic_id: before.epicId,
                  status: before.status,
                }),
              )
            : api.createTicket(body),
        )
      }
      close()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }
  async function remove() {
    if (!item || saving || !confirm('Permanently delete this ticket and its links?')) return
    setSaving(true)
    setError('')
    try {
      await mutate(api.deleteTicket(item.id))
      close()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }
  async function link(method: 'POST' | 'DELETE', link: Link) {
    setSaving(true)
    setError('')
    try {
      await mutate(method === 'POST' ? api.createLink(link) : api.deleteLink(link))
      setTarget('')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }
  const links =
    isTicket && item
      ? data.links.filter((l) => l.blocker_id === item.id || l.blocked_id === item.id)
      : []

  return (
    <Modal
      className={`modal ${isTicket ? 'ticket-modal' : ''}`}
      labelledBy="dialog-title"
      saving={saving}
      changed={changed}
      close={close}
    >
      {(requestClose) => (
        <>
          <div className="modal-heading">
            <div className="modal-title-icon">
              {isTicket ? (
                <TicketIcon size={18} />
              ) : dialog.type === 'epic' ? (
                <Layers size={18} />
              ) : (
                <Folder size={18} />
              )}
            </div>
            <h2 id="dialog-title">
              {liveTicket ? (
                <a
                  className="modal-ticket-link"
                  href={viewHref({ type: 'ticket', id: liveTicket.id })}
                  title="Open full ticket page"
                  onClick={(e) => {
                    if (saving) {
                      e.preventDefault()
                      return
                    }
                    if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
                      e.preventDefault()
                      if (!changed || confirm('Discard unsaved changes?')) openPage(liveTicket)
                    }
                  }}
                >
                  <span className="ticket-id">TT-{liveTicket.id}</span>
                  <span className="truncate">{liveTicket.title}</span>
                  <ArrowUpRight size={14} />
                </a>
              ) : item ? (
                isTicket ? (
                  `TT-${item.id}`
                ) : (
                  `Edit ${dialog.type}`
                )
              ) : (
                `New ${dialog.type}`
              )}
            </h2>
            <button
              className="icon-button"
              disabled={saving}
              onClick={requestClose}
              aria-label="Close dialog"
            >
              <X size={19} />
            </button>
          </div>
          <form onSubmit={submit}>
            <div className="modal-body">
              {error && (
                <div className="form-error" role="alert">
                  {error}
                </div>
              )}
              {isTicket && item && !liveTicket && (
                <div className="form-error" role="alert">
                  This ticket was deleted in another session.
                </div>
              )}
              <label className="field-label">
                {dialog.type === 'project' ? 'Name' : 'Title'}
                <input
                  required
                  maxLength={200}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={
                    isTicket
                      ? 'What needs to be done?'
                      : dialog.type === 'epic'
                        ? 'Epic title'
                        : 'Project name'
                  }
                />
              </label>
              {isTicket && (
                <label className="field-label">
                  Description
                  <textarea
                    aria-label="Description"
                    aria-describedby="description-help"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Add a description…"
                    rows={6}
                    maxLength={100000}
                  />
                  <span className="form-note" id="description-help">
                    Markdown and fenced mermaid diagrams supported.
                  </span>
                </label>
              )}
              {dialog.type === 'epic' && (
                <EpicFields
                  data={data}
                  projectId={projectId}
                  setProjectId={setProjectId}
                  completed={completed}
                  setCompleted={setCompleted}
                  archived={archived}
                  setArchived={setArchived}
                />
              )}
              {isTicket && (
                <TicketFields
                  data={data}
                  status={status}
                  setStatus={setStatus}
                  epicId={epicId}
                  setEpicId={setEpicId}
                />
              )}
              {isTicket && item && (
                <section className="dependencies">
                  <h3>
                    <Link2 size={14} />
                    Dependencies<span className="count">{links.length}</span>
                  </h3>
                  {links.map((l) => {
                    const blockedBy = l.blocked_id === item.id
                    const other = data.tickets.find(
                      (t) => t.id === (blockedBy ? l.blocker_id : l.blocked_id),
                    )
                    return (
                      <div className="dependency-row" key={`${l.blocker_id}-${l.blocked_id}`}>
                        <span className="dependency-type">
                          {blockedBy ? 'Blocked by' : 'Blocks'}
                        </span>
                        <button
                          type="button"
                          className="dependency-ticket"
                          onClick={() => {
                            if (other && (!changed || confirm('Discard unsaved changes?')))
                              openTicket(other)
                          }}
                        >
                          <span className="ticket-id">TT-{other?.id}</span>
                          <span className="truncate">{other?.title}</span>
                          {other?.status === 'done' && <Check size={13} />}
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="Remove dependency"
                          disabled={saving}
                          onClick={() => link('DELETE', l)}
                        >
                          <X size={13} />
                        </button>
                      </div>
                    )
                  })}
                  <div className="add-dependency">
                    <select
                      aria-label="Dependency type"
                      value={relation}
                      onChange={(e) => setRelation(e.target.value)}
                    >
                      <option value="blocked_by">Blocked by</option>
                      <option value="blocks">Blocks</option>
                    </select>
                    <select
                      aria-label="Linked ticket"
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                    >
                      <option value="">Select a ticket…</option>
                      {data.tickets
                        .filter(
                          (t) =>
                            t.id !== item.id &&
                            !links.some(
                              (l) =>
                                l.blocker_id === (relation === 'blocks' ? item.id : t.id) &&
                                l.blocked_id === (relation === 'blocks' ? t.id : item.id),
                            ),
                        )
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            TT-{t.id} · {t.title}
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      className="button secondary"
                      disabled={!target || saving}
                      onClick={() =>
                        link('POST', {
                          blocker_id: relation === 'blocks' ? item.id : Number(target),
                          blocked_id: relation === 'blocks' ? Number(target) : item.id,
                        })
                      }
                    >
                      <Plus size={14} />
                      <span>Link</span>
                    </button>
                  </div>
                </section>
              )}
              {isTicket && !item && (
                <div className="form-note">
                  <Link2 size={13} />
                  Dependencies can be added after creating the ticket.
                </div>
              )}
            </div>
            <div className="modal-footer">
              {isTicket && item && (
                <button
                  type="button"
                  className="icon-button delete-ticket"
                  aria-label="Delete ticket"
                  title="Delete ticket"
                  disabled={saving}
                  onClick={remove}
                >
                  <Trash2 size={16} />
                </button>
              )}
              <div className="modal-footer-right">
                <button
                  type="button"
                  className="button secondary"
                  disabled={saving}
                  onClick={requestClose}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button primary"
                  disabled={
                    saving ||
                    !title.trim() ||
                    (isTicket && !epicId) ||
                    (dialog.type === 'epic' && !projectId)
                  }
                >
                  {saving ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}
                  {item ? 'Save changes' : `Create ${dialog.type}`}
                </button>
              </div>
            </div>
          </form>
        </>
      )}
    </Modal>
  )
}

function changedFields<T extends object>(current: T, original: T): Partial<T> {
  const patch: Partial<T> = {}
  for (const key in current) if (current[key] !== original[key]) patch[key] = current[key]
  return patch
}
