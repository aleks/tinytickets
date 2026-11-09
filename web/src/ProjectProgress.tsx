import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Layers, LoaderCircle } from 'lucide-react'

type Status = 'todo' | 'in_progress' | 'ready_for_review' | 'done'
const statuses: { id: Status; label: string }[] = [
  { id: 'todo', label: 'Todo' }, { id: 'in_progress', label: 'In progress' },
  { id: 'ready_for_review', label: 'Ready for review' }, { id: 'done', label: 'Done' },
]
type Segment = { status: Status; start: string; end: string; ongoing: boolean }
type TicketTiming = {
  ticket: { id: number; title: string; status: Status }
  history_complete: boolean; observed_from: string | null
  timing_state: 'observed' | 'not_started' | 'unavailable'
  started_at: string | null; completed_at: string | null
  cycle_seconds: number | null; active_age_seconds: number | null
  in_progress_seconds: number; review_seconds: number; segments: Segment[]
}
type Metrics = {
  total: number; completed: number; active: number; blocked: number
  not_started: number; partial_history: number; timing_unavailable: number
  status_counts: Record<Status, number>; in_progress_seconds: number; review_seconds: number
  median_completion_seconds: number | null; completion_samples: number
  oldest_active_age_seconds: number | null; active_age_samples: number
}
type EpicTiming = { epic: { id: number; title: string; completed: boolean; archived: boolean }; metrics: Metrics; tickets: TicketTiming[] }
type Bucket = { date: string; tickets: number }
type Report = {
  project: { id: number; name: string }; generated_at: string; metrics: Metrics
  epics_total: number; epics_completed: number; epics_archived: number; epics: EpicTiming[]
  daily_completions: Bucket[]; weekly_completions: Bucket[]
}

export function duration(seconds: number | null): string {
  if (seconds === null) return '—'
  const value = Math.max(0, Math.floor(seconds))
  if (seconds <= 0) return '0s'
  if (value < 1) return '<1s'
  if (value < 60) return `${value}s`
  if (value < 3600) return `${Math.floor(value / 60)}m ${value % 60}s`
  if (value < 86400) return `${Math.floor(value / 3600)}h ${Math.floor(value % 3600 / 60)}m`
  return `${Math.floor(value / 86400)}d ${Math.floor(value % 86400 / 3600)}h`
}

function localTime(value: string | number) {
  return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function ProjectProgress({ projectID, revision }: { projectID: number; revision: object }) {
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [now, setNow] = useState(Date.now)
  const [range, setRange] = useState('all')
  const [hideCompleted, setHideCompleted] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [weekly, setWeekly] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const response = await fetch(`/api/projects/${projectID}/execution`, { signal: controller.signal })
        const next = await response.json()
        if (!response.ok) throw new Error(next.error || 'Unable to load project execution')
        if (!controller.signal.aborted) { setReport(next); setNow(Date.now()); setError('') }
      } catch (err) { if (!controller.signal.aborted) setError((err as Error).message) }
    }
    load()
    return () => controller.abort()
  }, [projectID, revision, retry])

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 10000)
    return () => clearInterval(tick)
  }, [])

  if (!report) return error ? <div className="form-error" role="alert">{error} <button className="text-button" onClick={() => setRetry(retry + 1)}>Retry</button></div> : <div className="loading"><LoaderCircle size={18} className="spin" />Loading execution history</div>
  const m = report.metrics
  const elapsed = Math.max(0, (now - Date.parse(report.generated_at)) / 1000)
  const epics = report.epics.filter(e => !e.epic.archived && (!hideCompleted || !e.epic.completed))
  const observed = epics.flatMap(e => e.tickets).filter(t => t.segments.length > 0)
  const starts = observed.flatMap(t => t.segments.map(s => Date.parse(s.start)))
  const ends = observed.flatMap(t => t.segments.map(s => s.ongoing ? now : Date.parse(s.end)))
  const right = Math.max(now, ...ends)
  const earliest = starts.length ? Math.min(...starts) : right - 1000
  const left = range === 'all' ? Math.min(earliest, right - 1000) : right - Number(range) * 1000
  const span = Math.max(1, right - left)
  const percent = (at: number) => (at - left) / span * 100
  const buckets = weekly ? report.weekly_completions : report.daily_completions
  const peak = Math.max(1, ...buckets.map(b => b.tickets))

  function bar(start: number, end: number) {
    if (end < left || start > right) return null
    const offset = Math.min(99.6, Math.max(0, percent(start)))
    return { left: `${offset}%`, width: `${Math.min(100 - offset, Math.max(.4, percent(Math.min(end, right)) - offset))}%` }
  }
  function toggle(id: number) { setCollapsed(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next }) }

  return <div className="project-progress">
    {error && <div className="form-error" role="alert">{error} <button className="text-button" onClick={() => setRetry(retry + 1)}>Retry</button></div>}
    <div className="execution-intro"><h2>Execution insights</h2><span>Updated <time dateTime={report.generated_at}>{localTime(report.generated_at)}</time></span></div>
    {report.epics_archived > 0 && <p className="archive-metrics-note">Summary metrics include {report.epics_archived} archived {report.epics_archived === 1 ? 'epic' : 'epics'}. Archived rows are hidden. <a href="#epics">View archives</a></p>}
    <div className="execution-metrics">
      <Metric label="Completed tickets" value={`${m.completed} / ${m.total}`} detail={`${report.epics_completed} / ${report.epics_total} epics completed · ticket counts, not effort`} />
      <Metric label="Active tickets" value={String(m.active)} detail={`${m.status_counts.in_progress} in progress · ${m.status_counts.ready_for_review} in review`} />
      <Metric label="Blocked tickets" value={String(m.blocked)} detail="Unfinished tickets with unfinished blockers" />
      <Metric label="Median completion time" value={duration(m.median_completion_seconds)} detail={`${m.completion_samples} completed tickets with known starts · includes reopen gaps`} />
      <Metric label="Observed work / review" value={`${duration(m.in_progress_seconds)} / ${duration(m.review_seconds)}`} detail="Summed ticket time, not agent effort or wall-clock project time" />
      <Metric label="Oldest active ticket" value={duration(m.oldest_active_age_seconds === null ? null : m.oldest_active_age_seconds + elapsed)} detail={`${m.active_age_samples} of ${m.active} active tickets have known starts`} />
    </div>
    <div className="execution-statuses" aria-label="Ticket status breakdown">{statuses.map(s => <span key={s.id}><span className={`execution-dot execution-${s.id}`} />{s.label}<strong>{m.status_counts[s.id]}</strong></span>)}</div>
    {m.partial_history > 0 && <p className="history-notice" role="note">{m.partial_history} {m.partial_history === 1 ? 'ticket has' : 'tickets have'} incomplete history. Only recorded intervals are shown; unknown starts are excluded from completion-time and age samples.</p>}

    <section className="execution-timeline" aria-label="Execution timeline">
      <div className="section-heading"><h2><Layers size={16} />Execution timeline</h2><div className="execution-controls"><label className="checkbox-label"><input type="checkbox" checked={hideCompleted} onChange={e => setHideCompleted(e.target.checked)} />Hide completed epics</label><select aria-label="Timeline range" value={range} onChange={e => setRange(e.target.value)}><option value="all">All recorded</option><option value="3600">Last hour</option><option value="86400">Last 24 hours</option><option value="604800">Last 7 days</option><option value="2592000">Last 30 days</option></select></div></div>
      <div className="timeline-scroll"><div className="timeline-grid">
        <div className="timeline-row timeline-axis"><div className="timeline-label">Epics & tickets <span className="muted">· local time</span></div><div className="timeline-track timeline-scale">{[0, 1, 2, 3, 4].map(i => <time key={i} style={{ left: `${i * 25}%` }} dateTime={new Date(left + span * i / 4).toISOString()}>{new Date(left + span * i / 4).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: span < 600000 ? '2-digit' : undefined, fractionalSecondDigits: span < 10000 ? 3 : undefined })}</time>)}</div></div>
        {epics.map(e => {
          const tickets = e.tickets.filter(t => t.segments.length > 0)
          const times = tickets.flatMap(t => t.segments)
          const first = times.length ? Math.min(...times.map(s => Date.parse(s.start))) : null
          const last = times.length ? Math.max(...times.map(s => s.ongoing ? now : Date.parse(s.end))) : null
          const epicBar = first !== null && last !== null ? bar(first, last) : null
          const expanded = !collapsed.has(e.epic.id)
          return <div className="timeline-epic" key={e.epic.id}>
            <div className="timeline-row epic-timeline-row"><div className="timeline-label"><div className="epic-timeline-title"><button className="icon-button" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${e.epic.title}`} aria-expanded={expanded} aria-controls={`epic-timing-${e.epic.id}`} onClick={() => toggle(e.epic.id)}>{expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button><a className="truncate" href={`#epic/${e.epic.id}`} title={e.epic.title}>{e.epic.title}</a>{e.epic.completed && <span className="badge">Completed</span>}</div><div className="epic-timing-summary">{e.metrics.completed}/{e.metrics.total} done · {e.metrics.active} active · {e.metrics.blocked} blocked</div><div className="epic-timing-summary muted">Work {duration(e.metrics.in_progress_seconds)} · Review {duration(e.metrics.review_seconds)}</div></div><div className="timeline-track">{epicBar ? <span className="epic-span" style={epicBar} role="img" aria-label={`Observed epic span: ${localTime(first!)} to ${localTime(last!)}`} /> : <span className="timeline-empty">{times.length ? 'Outside selected range' : 'No recorded execution'}</span>}<span className="timeline-now" title="Now" /></div></div>
            <div id={`epic-timing-${e.epic.id}`} hidden={!expanded}>{tickets.map(t => <div className="timeline-row ticket-timeline-row" key={t.ticket.id}><div className="timeline-label"><a className="timeline-ticket-link" href={`#ticket/${t.ticket.id}`} title={t.ticket.title}><span className="ticket-id">TT-{t.ticket.id}</span><span className="truncate">{t.ticket.title}</span></a><div className="ticket-timing-summary"><span>{statuses.find(s => s.id === t.ticket.status)?.label}</span>{!t.history_complete && <span className="partial-history">Partial history</span>}{t.history_complete && t.started_at === null && <span>Start not recorded</span>}{t.cycle_seconds !== null && <span>Cycle {duration(t.cycle_seconds)}</span>}{t.active_age_seconds !== null && <span>Age {duration(t.active_age_seconds + elapsed)}</span>}</div></div><div className="timeline-track">{t.segments.map((s, index) => {
              const style = bar(Date.parse(s.start), s.ongoing ? now : Date.parse(s.end))
              const label = `${statuses.find(status => status.id === s.status)?.label}: ${localTime(s.start)} → ${s.ongoing ? 'now' : localTime(s.end)}`
              return style && <span key={index} className={`timeline-segment execution-${s.status} ${s.ongoing ? 'ongoing-segment' : ''}`} style={style} role="img" aria-label={label} title={label} />
            })}<span className="timeline-now" title="Now" /></div></div>)}</div>
          </div>
        })}
        {!epics.length && <p className="execution-empty">{report.epics.length ? 'No epics match this filter.' : report.epics_archived ? 'All epics are archived.' : 'No epics yet.'}</p>}
      </div></div>
      <div className="timeline-legend">{statuses.map(s => <span key={s.id}><span className={`execution-dot execution-${s.id}`} />{s.id === 'todo' ? 'Returned to todo' : s.label}</span>)}<span>Bars show recorded execution, not a schedule. Done intervals between reopenings are preserved.</span></div>
    </section>

    <div className="execution-untimed">{(['not_started', 'unavailable'] as const).map(kind => {
      const items = epics.flatMap(e => e.tickets.filter(t => t.timing_state === kind).map(t => ({ ...t, epic: e.epic })))
      return <section key={kind} className="untimed-section"><h2>{kind === 'not_started' ? 'Not started' : 'Timing unavailable'}<span className="count">{items.length}</span></h2><p className="muted">{kind === 'not_started' ? 'No execution has been recorded for these new tickets.' : 'Earlier execution dates cannot be inferred from creation or update timestamps.'}</p><ul>{items.map(t => <li key={t.ticket.id}><a href={`#ticket/${t.ticket.id}`}><span className="ticket-id">TT-{t.ticket.id}</span>{t.ticket.title}</a><span className="untimed-epic">{t.epic.title} · {statuses.find(s => s.id === t.ticket.status)?.label}</span></li>)}</ul>{!items.length && <span className="muted">None</span>}</section>
    })}</div>

    <section className="execution-throughput" aria-label="Recorded completions"><div className="section-heading"><h2>Recorded completions <span className="count">{buckets.reduce((sum, b) => sum + b.tickets, 0)}</span></h2><div className="period-buttons" role="group" aria-label="Completion period"><button aria-pressed={!weekly} onClick={() => setWeekly(false)}>Daily</button><button aria-pressed={weekly} onClick={() => setWeekly(true)}>Weekly</button></div></div><ol className="throughput-chart" aria-label={`${weekly ? 'Weekly' : 'Daily'} recorded completions`}>{buckets.map(b => <li key={b.date} aria-label={`${b.date}: ${b.tickets} tickets`} title={`${weekly ? 'Week of ' : ''}${b.date}: ${b.tickets} first observed completions`}><span className="throughput-value">{b.tickets || ''}</span><span className="throughput-bar" style={{ height: `${Math.max(2, b.tickets / peak * 70)}px` }} /><time dateTime={b.date}>{b.date.slice(5)}</time></li>)}</ol><p className="muted">UTC · {weekly ? '12 weeks, Monday starts' : '28 days'} · Each ticket counts once at its first observed completion, even if reopened. Attribution follows current project membership; unrecorded history is not reconstructed.</p></section>
  </div>
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="execution-metric"><h3>{label}</h3><strong>{value}</strong><span>{detail}</span></div>
}
