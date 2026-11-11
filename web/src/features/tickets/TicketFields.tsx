import { ChevronDown } from 'lucide-react'
import { statuses as columns, isStatus } from '../../shared/status'
import type { Status, Workspace } from '../../shared/types'

export function TicketFields({
  data,
  status,
  setStatus,
  epicId,
  setEpicId,
}: {
  data: Workspace
  status: Status
  setStatus: (status: Status) => void
  epicId: number
  setEpicId: (id: number) => void
}) {
  return (
    <div className="field-row">
      <label className="field-label">
        Status
        <div className="select-wrap">
          <select
            value={status}
            onChange={(e) => {
              if (isStatus(e.target.value)) setStatus(e.target.value)
            }}
          >
            {columns.map((c) => (
              <option key={c.status} value={c.status}>
                {c.label}
              </option>
            ))}
          </select>
          <ChevronDown size={14} />
        </div>
      </label>
      <label className="field-label">
        Epic
        <div className="select-wrap">
          <select required value={epicId} onChange={(e) => setEpicId(Number(e.target.value))}>
            {data.epics
              .filter((e) => !e.archived || e.id === epicId)
              .map((e) => (
                <option key={e.id} value={e.id} disabled={e.archived}>
                  {data.projects.find((p) => p.id === e.project_id)?.name} / {e.title}
                  {e.archived ? ' (archived)' : e.completed ? ' (completed)' : ''}
                </option>
              ))}
          </select>
          <ChevronDown size={14} />
        </div>
      </label>
    </div>
  )
}
