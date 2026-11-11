import { Archive, ArrowUpRight, Check } from 'lucide-react'
import type { Epic, Workspace } from '../../shared/types'

export function EpicCard({
  epic,
  data,
  onClick,
}: {
  epic: Epic
  data: Workspace
  onClick: () => void
}) {
  const tickets = data.tickets.filter((t) => t.epic_id === epic.id)
  const done = tickets.filter((t) => t.status === 'done').length
  const percent = tickets.length ? Math.round((done / tickets.length) * 100) : 0
  const projectIndex = data.projects.findIndex((p) => p.id === epic.project_id)
  return (
    <button className={`epic-card ${epic.completed ? 'is-completed' : ''}`} onClick={onClick}>
      <div className="epic-card-top">
        <span className={`project-label color-${projectIndex % 5}`}>
          <span className="project-dot" />
          {data.projects[projectIndex]?.name}
        </span>
        {epic.archived ? (
          <span className="badge">
            <Archive size={11} />
            Archived
          </span>
        ) : epic.completed ? (
          <span className="badge">
            <Check size={11} />
            Completed
          </span>
        ) : (
          <ArrowUpRight size={15} className="card-arrow" />
        )}
      </div>
      <h3>{epic.title}</h3>
      <div className="epic-progress-label">
        <span>
          {done}
          <span className="muted"> / {tickets.length} tickets</span>
        </span>
        <span className="muted">{percent}%</span>
      </div>
      <div className="progress-track">
        <span style={{ width: `${percent}%` }} />
      </div>
    </button>
  )
}
