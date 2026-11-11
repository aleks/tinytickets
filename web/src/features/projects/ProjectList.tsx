import { ArrowUpRight, Folder, FolderPlus } from 'lucide-react'
import type { Epic, Workspace } from '../../shared/types'
import { SearchField } from '../../shared/ui/SearchField'
import type { View } from '../../app/routing'
import type { Dialog } from '../editor/dialog'

export function ProjectList({
  data,
  unarchivedEpics,
  query,
  setQuery,
  navigate,
  setDialog,
}: {
  data: Workspace
  unarchivedEpics: Epic[]
  query: string
  setQuery: (query: string) => void
  navigate: (view: View) => void
  setDialog: (dialog: Dialog) => void
}) {
  return (
    <>
      <div className="section-heading">
        <h2>
          All projects <span className="count">{data.projects.length}</span>
        </h2>
        <SearchField value={query} onChange={setQuery} placeholder="Find a project…" />
      </div>
      <div className="project-grid">
        {data.projects
          .filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
          .map((p, i) => (
            <button
              className="project-card"
              key={p.id}
              onClick={() => navigate({ type: 'project', id: p.id })}
            >
              <div className={`project-icon color-${i % 5}`}>
                <Folder size={21} />
              </div>
              <h3>{p.name}</h3>
              <span>{unarchivedEpics.filter((e) => e.project_id === p.id).length} epics</span>
              <ArrowUpRight size={16} className="card-arrow" />
            </button>
          ))}
        <button className="add-project" onClick={() => setDialog({ type: 'project' })}>
          <FolderPlus size={20} />
          New project
        </button>
      </div>
    </>
  )
}
