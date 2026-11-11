import { useEffect, useRef, useState } from 'react'
import { api, ApiError, errorMessage, type Mutate } from '../../shared/api'
import type { DeletionKind, DeletionPreview } from '../../shared/types'
import { Modal } from '../../shared/ui/Modal'

export function DeletionDialog({
  kind,
  id,
  name,
  mutate,
  close,
  deleted,
}: {
  kind: DeletionKind
  id: number
  name: string
  mutate: Mutate
  close: () => void
  deleted: () => void
}) {
  const noun = kind === 'projects' ? 'project' : kind === 'epics' ? 'epic' : 'ticket'
  const [preview, setPreview] = useState<DeletionPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [force, setForce] = useState(false)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const controller = useRef<AbortController | null>(null)
  const inFlight = useRef(false)

  useEffect(() => {
    const request = new AbortController()
    controller.current = request
    setLoading(true)
    setPreview(null)
    setForce(false)
    setMissing(false)
    void api.deletionPreview(kind, id, request.signal).then(
      (result) => {
        if (request.signal.aborted) return
        setPreview(result)
        setUncertain(false)
        setLoading(false)
      },
      (err: unknown) => {
        if (request.signal.aborted) return
        const gone = err instanceof ApiError && err.status === 404
        setMissing(gone)
        setError(gone ? `This ${noun} has already been deleted.` : errorMessage(err))
        setLoading(false)
      },
    )
    return () => request.abort()
  }, [kind, id, noun, attempt])

  async function remove() {
    if (inFlight.current || !preview || loading || uncertain || (preview.requires_force && !force))
      return
    inFlight.current = true
    setSaving(true)
    setError('')
    const request = new AbortController()
    controller.current = request
    try {
      await mutate(
        api.deleteResource(
          kind,
          id,
          {
            confirmation_token: preview.confirmation_token,
            ...(preview.requires_force ? { force: true } : {}),
          },
          request.signal,
        ),
      )
      if (!request.signal.aborted) deleted()
    } catch (err) {
      if (request.signal.aborted) return
      setForce(false)
      if (err instanceof ApiError && err.status === 409) {
        setPreview(null)
        setError('The deletion scope changed. Review the refreshed preview and confirm again.')
        setAttempt((value) => value + 1)
      } else if (err instanceof ApiError && err.status === 404) {
        setPreview(null)
        setMissing(true)
        setError(`This ${noun} has already been deleted.`)
      } else {
        setUncertain(true)
        setError(
          `${errorMessage(err)}. Deletion was not retried; the request may have succeeded. Refresh the preview before confirming again.`,
        )
      }
    } finally {
      inFlight.current = false
      if (!request.signal.aborted) setSaving(false)
    }
  }

  useEffect(() => () => controller.current?.abort(), [])

  return (
    <Modal
      className="modal deletion-modal"
      labelledBy="deletion-title"
      saving={saving}
      changed={false}
      close={close}
      initialFocus="[data-deletion-cancel]"
    >
      {(requestClose) => (
        <>
          <div className="modal-heading">
            <h2 id="deletion-title">Delete {noun}</h2>
          </div>
          <div className="modal-body">
            <p>
              Permanently delete <strong className="deletion-name">{preview?.name || name}</strong>?
            </p>
            {loading && <p role="status">Loading deletion preview…</p>}
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            {!loading && !missing && (!preview || uncertain) && (
              <button
                className="button secondary"
                disabled={saving}
                onClick={() => {
                  setError('')
                  setAttempt((value) => value + 1)
                }}
              >
                Retry preview
              </button>
            )}
            {preview && (
              <>
                <section aria-label="Deletion scope">
                  <h3>Deletion scope</h3>
                  <ul className="deletion-counts">
                    {kind === 'projects' && (
                      <li>
                        {preview.counts.epics} epics ({preview.counts.archived_epics} archived)
                      </li>
                    )}
                    {kind !== 'tickets' && <li>{preview.counts.tickets} tickets</li>}
                    <li>
                      {preview.counts.work_log_entries} work log entries (including review handoffs)
                    </li>
                    <li>{preview.counts.status_events} status history events</li>
                    <li>{preview.counts.dependency_links} dependency links</li>
                  </ul>
                </section>
                {preview.counts.external_dependency_links > 0 && (
                  <p className="deletion-warning">
                    {preview.counts.external_dependency_links} dependency links cross this
                    hierarchy. Linked tickets outside the chosen hierarchy survive; removing these
                    dependencies may make them ready.
                  </p>
                )}
                {kind !== 'tickets' && preview.requires_force && (
                  <label className="deletion-force">
                    <input
                      type="checkbox"
                      checked={force}
                      disabled={saving || uncertain}
                      onChange={(event) => setForce(event.target.checked)}
                    />
                    Force delete — also delete this {noun}’s contents
                  </label>
                )}
                {(kind === 'tickets' || !preview.requires_force || force) && (
                  <p className="deletion-warning">
                    This permanently deletes the {noun}
                    {kind === 'projects'
                      ? ' and all its epics and tickets'
                      : kind === 'epics'
                        ? ' and all its tickets'
                        : ''}
                    , associated work logs, review handoffs, status history, and dependency links.
                    Their metrics are removed, not archived. This cannot be undone.
                    {kind === 'tickets' ? ' Any unsaved editor draft will also be discarded.' : ''}
                  </p>
                )}
              </>
            )}
          </div>
          <div className="modal-footer">
            <div className="modal-footer-right">
              <button
                className="button secondary"
                data-deletion-cancel
                disabled={saving}
                onClick={requestClose}
              >
                Cancel
              </button>
              <button
                className="button deletion-submit"
                disabled={
                  loading || saving || !preview || uncertain || (preview.requires_force && !force)
                }
                onClick={remove}
              >
                {saving ? 'Deleting…' : `Delete ${noun}`}
              </button>
            </div>
          </div>
        </>
      )}
    </Modal>
  )
}
