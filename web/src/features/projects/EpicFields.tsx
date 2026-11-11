import type { Workspace } from '../../shared/types'

export function EpicFields({
  data,
  projectId,
  setProjectId,
  completed,
  setCompleted,
  archived,
  setArchived,
}: {
  data: Workspace
  projectId: number
  setProjectId: (id: number) => void
  completed: boolean
  setCompleted: (completed: boolean) => void
  archived: boolean
  setArchived: (archived: boolean) => void
}) {
  return (
    <>
      <label className="field-label">
        Project
        <select required value={projectId} onChange={(e) => setProjectId(Number(e.target.value))}>
          {data.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={completed}
          disabled={archived}
          onChange={(e) => setCompleted(e.target.checked)}
        />
        Completed
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={archived}
          disabled={!completed}
          onChange={(e) => setArchived(e.target.checked)}
        />
        Archived
      </label>
      {archived && <span className="form-note">Unarchive this epic before reopening it.</span>}
    </>
  )
}
