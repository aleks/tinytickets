import { Archive, ArchiveRestore, Check, MoreHorizontal, Pencil, Plus } from 'lucide-react'
import type { Project, Epic, Ticket, Workspace } from '../shared/types'
import type { View } from './routing'
import type { Dialog } from '../features/editor/dialog'

export function PageHeading({
  currentTicket,
  currentEpic,
  currentProject,
  title,
  view,
  busy,
  archive,
  complete,
  remove,
  setDialog,
  data,
  notFound,
  newTicket,
}: {
  currentTicket: Ticket | undefined
  currentEpic: Epic | undefined
  currentProject: Project | undefined
  title: string
  view: View
  busy: boolean
  archive: (epic: Epic, archived: boolean) => void
  complete: (epic: Epic) => void
  remove: (kind: 'projects' | 'epics', id: number) => void
  setDialog: (dialog: Dialog) => void
  data: Workspace
  notFound: boolean
  newTicket: () => void
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">
          {currentTicket
            ? `TT-${currentTicket.id}`
            : view.type === 'home'
              ? 'YOUR WORKSPACE'
              : view.type === 'epic'
                ? 'EPIC'
                : view.type === 'project'
                  ? 'PROJECT'
                  : 'WORKSPACE'}
        </div>
        <h1>
          {title}
          {currentEpic?.completed && (
            <span className="badge completed-badge">
              {currentEpic.archived ? <Archive size={12} /> : <Check size={12} />}
              {currentEpic.archived ? 'Archived' : 'Completed'}
            </span>
          )}
        </h1>
      </div>
      <div className="heading-actions">
        {currentEpic && (
          <>
            {currentEpic.archived ? (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => archive(currentEpic, false)}
              >
                <ArchiveRestore size={15} />
                Unarchive epic
              </button>
            ) : (
              <>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => complete(currentEpic)}
                >
                  <Check size={15} />
                  {currentEpic.completed ? 'Reopen epic' : 'Complete epic'}
                </button>
                {currentEpic.completed && (
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => archive(currentEpic, true)}
                  >
                    <Archive size={15} />
                    Archive epic
                  </button>
                )}
              </>
            )}
            <details className="more-menu">
              <summary className="icon-button" aria-label="Epic options">
                <MoreHorizontal size={19} />
              </summary>
              <div className="dropdown">
                <button onClick={() => setDialog({ type: 'epic', item: currentEpic })}>
                  Edit epic
                </button>
                <button className="danger-text" onClick={() => remove('epics', currentEpic.id)}>
                  Delete epic
                </button>
              </div>
            </details>
          </>
        )}
        {currentProject && (
          <details className="more-menu">
            <summary className="icon-button" aria-label="Project options">
              <MoreHorizontal size={19} />
            </summary>
            <div className="dropdown">
              <button onClick={() => setDialog({ type: 'project', item: currentProject })}>
                Edit project
              </button>
              <button className="danger-text" onClick={() => remove('projects', currentProject.id)}>
                Delete project
              </button>
            </div>
          </details>
        )}
        {currentTicket ? (
          <button
            className="button primary"
            onClick={() => setDialog({ type: 'ticket', item: currentTicket })}
          >
            <Pencil size={15} />
            Edit ticket
          </button>
        ) : view.type === 'projects' ? (
          <button className="button primary" onClick={() => setDialog({ type: 'project' })}>
            <Plus size={16} />
            New project
          </button>
        ) : view.type === 'epics' ? (
          <button
            className="button primary"
            onClick={() => setDialog(data.projects.length ? { type: 'epic' } : { type: 'project' })}
          >
            <Plus size={16} />
            New epic
          </button>
        ) : (
          !notFound &&
          view.type !== 'ticket' &&
          !currentEpic?.archived && (
            <button className="button primary" onClick={() => newTicket()}>
              <Plus size={16} />
              New ticket
            </button>
          )
        )}
      </div>
    </div>
  )
}
