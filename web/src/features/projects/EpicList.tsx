import { useId, useState } from 'react'
import { Archive, ArrowUpRight, Layers, Plus } from 'lucide-react'
import type { Project, Epic, Workspace } from '../../shared/types'
import { SearchField } from '../../shared/ui/SearchField'
import { EpicCard } from './EpicCard'
import type { View } from '../../app/routing'
import type { Dialog } from '../editor/dialog'

export function EpicList({
  view,
  data,
  query,
  setQuery,
  setDialog,
  currentProject,
  listingEpics,
  filteredEpics,
  allArchivedEpics,
  archivedEpics,
  navigate,
}: {
  view: View
  data: Workspace
  query: string
  setQuery: (query: string) => void
  setDialog: (dialog: Dialog) => void
  currentProject: Project | undefined
  listingEpics: Epic[]
  filteredEpics: Epic[]
  allArchivedEpics: Epic[]
  archivedEpics: Epic[]
  navigate: (view: View) => void
}) {
  const [showArchived, setShowArchived] = useState(false)
  const epicGridID = useId()
  const projectArchives = view.type === 'project' && allArchivedEpics.length > 0
  const includeArchived = view.type === 'project' && showArchived
  const listingCount = listingEpics.length + (includeArchived ? allArchivedEpics.length : 0)
  const displayedEpics = includeArchived
    ? [...filteredEpics, ...archivedEpics].sort(
        (a, b) => Number(a.completed) - Number(b.completed) || b.id - a.id,
      )
    : filteredEpics

  return (
    <>
      {view.type !== 'epic' && (
        <section
          className="epics-section"
          aria-label={view.type === 'epics' ? 'Active and completed epics' : undefined}
        >
          <div className="section-heading">
            <div className="epic-list-heading">
              <h2>
                <Layers size={17} />
                {view.type === 'epics'
                  ? 'Active & completed epics'
                  : view.type === 'home'
                    ? 'Active epics'
                    : 'Epics'}
                <span className="count">{listingCount}</span>
              </h2>
              {projectArchives && (
                <button
                  className="text-button"
                  aria-expanded={showArchived}
                  aria-controls={epicGridID}
                  onClick={() => setShowArchived((previous) => !previous)}
                >
                  {showArchived ? 'Hide' : 'Show'} archived epics ({allArchivedEpics.length})
                </button>
              )}
            </div>
            {view.type === 'epics' ? (
              <SearchField value={query} onChange={setQuery} placeholder="Find an epic…" />
            ) : (
              <button
                className="text-button"
                onClick={() =>
                  setDialog(
                    data.projects.length
                      ? { type: 'epic', projectId: currentProject?.id }
                      : { type: 'project' },
                  )
                }
              >
                <Plus size={14} />
                New epic
              </button>
            )}
          </div>
          <div className="epic-grid" id={epicGridID}>
            {displayedEpics.map((e) => (
              <EpicCard
                key={e.id}
                epic={e}
                data={data}
                onClick={() => navigate({ type: 'epic', id: e.id })}
              />
            ))}
            {!listingCount && (
              <button
                className="empty-epic"
                onClick={() =>
                  setDialog(
                    data.projects.length
                      ? { type: 'epic', projectId: currentProject?.id }
                      : { type: 'project' },
                  )
                }
              >
                <span className="empty-icon">
                  <Layers size={21} />
                </span>
                <span>
                  <strong>
                    {view.type === 'home' && data.epics.length
                      ? 'All epics completed'
                      : (view.type === 'epics' || view.type === 'project') &&
                          allArchivedEpics.length
                        ? 'No unarchived epics'
                        : 'No epics yet'}
                  </strong>
                  <span>
                    {data.projects.length ? 'Create an epic' : 'Create your first project'}{' '}
                    <ArrowUpRight size={12} />
                  </span>
                </span>
                <Plus size={18} />
              </button>
            )}
            {query && listingCount > 0 && !displayedEpics.length && (
              <p className="muted">No matching epics.</p>
            )}
          </div>
        </section>
      )}
      {view.type === 'epics' && (
        <section className="archived-epics-section" aria-label="Archived epics">
          <div className="section-heading">
            <h2>
              <Archive size={17} />
              Archived epics<span className="count">{allArchivedEpics.length}</span>
            </h2>
          </div>
          <div className="epic-grid">
            {archivedEpics.map((e) => (
              <EpicCard
                key={e.id}
                epic={e}
                data={data}
                onClick={() => navigate({ type: 'epic', id: e.id })}
              />
            ))}
          </div>
          {!archivedEpics.length && (
            <p className="muted">
              {query && allArchivedEpics.length
                ? 'No matching archived epics.'
                : 'No archived epics.'}
            </p>
          )}
        </section>
      )}
    </>
  )
}
