import { lazy, Suspense, useState } from 'react'
import { ClipboardCheck, MessageSquare } from 'lucide-react'
import { api, errorMessage, type Mutate } from '../../shared/api'
import { useTicketWorkLog } from './useTicketWorkLog'

const MarkdownDescription = lazy(() =>
  import('../markdown/MarkdownDescription').then((module) => ({
    default: module.MarkdownDescription,
  })),
)

function Markdown({ source }: { source: string }) {
  return (
    <Suspense fallback={<p className="muted">Loading entry…</p>}>
      <MarkdownDescription source={source} />
    </Suspense>
  )
}

export function TicketWorkLog({
  ticketID,
  revision,
  mutate,
}: {
  ticketID: number
  revision: unknown
  mutate: Mutate
}) {
  const { entries, loaded, error: loadError, retry, accept } = useTicketWorkLog(ticketID, revision)
  const [kind, setKind] = useState('note')
  const [body, setBody] = useState('')
  const [author, setAuthor] = useState('')
  const [verification, setVerification] = useState('')
  const [references, setReferences] = useState('')
  const [reviewNotes, setReviewNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const handoff = kind === 'review_handoff'

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const entry = handoff
        ? (
            await mutate(
              api.createReviewHandoff(ticketID, {
                summary: body,
                verification,
                references,
                review_notes: reviewNotes,
                author,
              }),
            )
          ).entry
        : await mutate(api.addWorkLog(ticketID, { body, author }))
      accept(entry)
      setBody('')
      setVerification('')
      setReferences('')
      setReviewNotes('')
      setNotice(
        handoff ? 'Review handoff saved. Ticket is ready for review.' : 'Work log entry added.',
      )
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="ticket-work-log" aria-labelledby={`work-log-heading-${ticketID}`}>
      <div className="section-heading">
        <h2 id={`work-log-heading-${ticketID}`}>
          <MessageSquare size={14} />
          Work log{loaded && <span className="count">{entries.length}</span>}
        </h2>
        <span className="muted work-log-order">Oldest first · Append-only</span>
      </div>
      {loadError && (
        <div className="form-error" role="alert">
          {loadError}{' '}
          <button className="text-button" onClick={retry}>
            Retry loading log
          </button>
        </div>
      )}
      {!loaded && !loadError && (
        <p className="muted" role="status">
          Loading work log…
        </p>
      )}
      {loaded && !entries.length && <p className="muted">No work log entries yet.</p>}
      <ol className="work-log-entries" aria-label="Work log entries">
        {entries.map((entry) => (
          <li key={entry.id} className="work-log-entry" data-entry-id={entry.id}>
            <div className="work-log-entry-header">
              <span
                className={`work-log-kind ${entry.kind === 'review_handoff' ? 'handoff-kind' : ''}`}
              >
                {entry.kind === 'review_handoff' ? (
                  <ClipboardCheck size={13} />
                ) : (
                  <MessageSquare size={13} />
                )}
                {entry.kind === 'review_handoff' ? 'Review handoff' : 'Work note'}
              </span>
              {entry.author && (
                <span
                  className="work-log-author"
                  title="Informational author label, not authenticated identity"
                >
                  {entry.author}
                </span>
              )}
              <time dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleString()}</time>
            </div>
            <Markdown source={entry.body} />
            {entry.kind === 'review_handoff' && (
              <div className="handoff-fields">
                <h3>Verification</h3>
                <Markdown source={entry.verification} />
                {entry.references && (
                  <>
                    <h3>References</h3>
                    <Markdown source={entry.references} />
                  </>
                )}
                {entry.review_notes && (
                  <>
                    <h3>Review notes</h3>
                    <Markdown source={entry.review_notes} />
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
      <details className="work-log-composer">
        <summary>Add an update</summary>
        <form onSubmit={submit} aria-label="Add work log update">
          <fieldset disabled={saving}>
            <div className="work-log-composer-row">
              <label className="field-label">
                Update type
                <select
                  aria-label="Update type"
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value)
                    setError('')
                    setNotice('')
                  }}
                >
                  <option value="note">Work note</option>
                  <option value="review_handoff">Review handoff</option>
                </select>
              </label>
              <label className="field-label">
                Author (optional)
                <input
                  aria-label="Author (optional)"
                  maxLength={200}
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  placeholder="Name or agent label"
                />
              </label>
            </div>
            <label className="field-label">
              {handoff ? 'Summary' : 'Log entry'}
              <textarea
                aria-label={handoff ? 'Summary' : 'Log entry'}
                required
                maxLength={100000}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={
                  handoff ? 'What changed?' : 'Progress, decisions, blockers, or test results…'
                }
              />
            </label>
            {handoff && (
              <>
                <label className="field-label">
                  Verification
                  <textarea
                    aria-label="Verification"
                    required
                    maxLength={100000}
                    value={verification}
                    onChange={(e) => setVerification(e.target.value)}
                    placeholder="Checks run and their results, including failures or checks not run"
                  />
                </label>
                <label className="field-label">
                  References (optional)
                  <textarea
                    aria-label="References (optional)"
                    maxLength={100000}
                    value={references}
                    onChange={(e) => setReferences(e.target.value)}
                    placeholder="Commit hashes, artifact links, or pull requests"
                  />
                </label>
                <label className="field-label">
                  Review notes (optional)
                  <textarea
                    aria-label="Review notes (optional)"
                    maxLength={100000}
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    placeholder="What should the reviewer check? Any remaining risks?"
                  />
                </label>
              </>
            )}
            <p className="muted work-log-help">
              Markdown supported. Updates cannot be edited or removed; append a correction instead.
              {handoff && ' Saving also moves this ticket to Ready for review.'}
            </p>
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <button
              className="button primary"
              type="submit"
              disabled={saving || !body.trim() || (handoff && !verification.trim())}
            >
              {saving ? 'Saving…' : handoff ? 'Save handoff & request review' : 'Add log entry'}
            </button>
          </fieldset>
        </form>
      </details>
      <p className="work-log-notice" role="status">
        {notice}
      </p>
    </section>
  )
}
