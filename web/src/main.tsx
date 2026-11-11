import React, { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ArrowUpRight,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  Circle,
  CircleDot,
  Folder,
  FolderPlus,
  Home,
  Layers,
  Link2,
  LoaderCircle,
  Menu,
  Moon,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Sun,
  Ticket as TicketIcon,
  Trash2,
  X,
} from 'lucide-react'
import './style.css'
import { TicketColumnTimer } from './TicketColumnTimer'
import { TicketWorkLog } from './TicketWorkLog'

const MarkdownDescription = lazy(() =>
  import('./MarkdownDescription').then((module) => ({ default: module.MarkdownDescription })),
)
const ProjectProgress = lazy(() =>
  import('./ProjectProgress').then((module) => ({ default: module.ProjectProgress })),
)
const DependencyMap = lazy(() =>
  import('./DependencyMap').then((module) => ({ default: module.DependencyMap })),
)

type Project = { id: number; name: string }
type Epic = { id: number; project_id: number; title: string; completed: boolean; archived: boolean }
type Status = 'todo' | 'in_progress' | 'ready_for_review' | 'done'
type Ticket = {
  id: number
  epic_id: number
  title: string
  description: string
  status: Status
  created_at: string
  updated_at: string
  status_since: string | null
}
type Link = { blocker_id: number; blocked_id: number }
type Workspace = { projects: Project[]; epics: Epic[]; tickets: Ticket[]; links: Link[] }
type View =
  | { type: 'home' }
  | { type: 'projects' }
  | { type: 'epics' }
  | { type: 'project'; id: number; tab?: 'progress' | 'dependencies' }
  | { type: 'epic'; id: number }
  | { type: 'ticket'; id: number }
type Dialog =
  | { type: 'project'; item?: Project }
  | { type: 'epic'; item?: Epic; projectId?: number }
  | { type: 'ticket'; item?: Ticket; epicId?: number; status?: Status }
const columns: { status: Status; label: string; icon: typeof Circle }[] = [
  { status: 'todo', label: 'Todo', icon: Circle },
  { status: 'in_progress', label: 'In progress', icon: CircleDot },
  { status: 'ready_for_review', label: 'Ready for review', icon: CheckCircle2 },
  { status: 'done', label: 'Done', icon: CheckCheck },
]
const empty: Workspace = { projects: [], epics: [], tickets: [], links: [] }
const accents = [
  { id: 'sage', label: 'Sage', color: '#3c6957' },
  { id: 'slate', label: 'Slate', color: '#526c80' },
  { id: 'lavender', label: 'Lavender', color: '#786388' },
  { id: 'clay', label: 'Clay', color: '#916956' },
  { id: 'sand', label: 'Sand', color: '#85713e' },
] as const

async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

function initialView(): View {
  const path = location.hash.slice(1).split('/')
  if (path[0] === 'projects') return { type: 'projects' }
  if (path[0] === 'epics') return { type: 'epics' }
  if (
    path[0] === 'project' &&
    (path[2] === 'progress' || path[2] === 'dependencies') &&
    Number.isSafeInteger(Number(path[1])) &&
    Number(path[1]) > 0
  )
    return { type: 'project', id: Number(path[1]), tab: path[2] }
  if (
    (path[0] === 'project' || path[0] === 'epic' || path[0] === 'ticket') &&
    Number.isSafeInteger(Number(path[1])) &&
    Number(path[1]) > 0
  )
    return { type: path[0], id: Number(path[1]) }
  return { type: 'home' }
}

function viewHref(view: View): string {
  return `#${view.type === 'home' ? '' : 'id' in view ? `${view.type}/${view.id}${view.type === 'project' && view.tab ? `/${view.tab}` : ''}` : view.type}`
}

function App() {
  const [data, setData] = useState<Workspace>(empty)
  const [loaded, setLoaded] = useState(false)
  const [connected, setConnected] = useState(false)
  const [view, setView] = useState<View>(initialView)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [theme, setTheme] = useState(document.documentElement.dataset.theme || 'light')
  const [dragOver, setDragOver] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const requestNumber = useRef(0)

  async function refresh() {
    const n = ++requestNumber.current
    try {
      const next = await api<Workspace>('state')
      if (n === requestNumber.current) {
        setData(next)
        setLoaded(true)
      }
    } catch (err) {
      if (n === requestNumber.current) setError((err as Error).message)
    }
  }

  useEffect(() => {
    refresh()
    const events = new EventSource('/api/events')
    events.onopen = () => setConnected(true)
    events.onerror = () => setConnected(false)
    events.addEventListener('change', refresh)
    // Fallback for proxies that buffer SSE, and catch up when a sleeping tab wakes.
    const poll = window.setInterval(refresh, 15000)
    const focus = () => {
      if (!document.hidden) refresh()
    }
    document.addEventListener('visibilitychange', focus)
    const hash = () => {
      setView(initialView())
      setQuery('')
      setSidebarOpen(false)
    }
    window.addEventListener('hashchange', hash)
    return () => {
      events.close()
      clearInterval(poll)
      document.removeEventListener('visibilitychange', focus)
      window.removeEventListener('hashchange', hash)
    }
  }, [])

  function navigate(next: View) {
    location.hash = viewHref(next)
    setView(next)
    setQuery('')
    setSidebarOpen(false)
  }
  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem('theme', next)
    } catch {
      /* storage may be disabled */
    }
  }
  async function mutate(path: string, method: string, body?: unknown) {
    const result = await api(path, method, body)
    await refresh()
    return result
  }
  async function move(id: number, status: Status) {
    const ticket = data.tickets.find((t) => t.id === id)
    if (!ticket || ticket.status === status) return
    try {
      await mutate(`tickets/${id}`, 'PATCH', { status })
    } catch (err) {
      setError((err as Error).message)
    }
  }
  async function complete(epic: Epic) {
    if (busy) return
    setBusy(true)
    try {
      await mutate(`epics/${epic.id}`, 'PATCH', { completed: !epic.completed })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function archive(epic: Epic, archived: boolean) {
    if (busy) return
    setBusy(true)
    try {
      await mutate(`epics/${epic.id}`, 'PATCH', { archived })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function remove(kind: 'projects' | 'epics', id: number) {
    if (!confirm(`Delete this ${kind === 'projects' ? 'project' : 'epic'}? It must be empty.`))
      return
    try {
      await mutate(`${kind}/${id}`, 'DELETE')
      navigate({ type: kind })
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const currentProject =
    view.type === 'project' ? data.projects.find((p) => p.id === view.id) : undefined
  const currentEpic = view.type === 'epic' ? data.epics.find((e) => e.id === view.id) : undefined
  const currentTicket =
    view.type === 'ticket' ? data.tickets.find((t) => t.id === view.id) : undefined
  const ticketEpic = currentTicket && data.epics.find((e) => e.id === currentTicket.epic_id)
  const title =
    view.type === 'home'
      ? 'Overview'
      : view.type === 'projects'
        ? 'Projects'
        : view.type === 'epics'
          ? 'Epics'
          : currentProject?.name || currentEpic?.title || currentTicket?.title || 'Not found'
  const unarchivedEpics = data.epics.filter((e) => !e.archived)
  const allArchivedEpics = data.epics.filter((e) => e.archived)
  const visibleEpics = data.epics.filter((e) =>
    view.type === 'epic'
      ? e.id === view.id
      : view.type === 'epics'
        ? true
        : !e.archived &&
          (view.type === 'home'
            ? !e.completed
            : view.type === 'project'
              ? e.project_id === view.id
              : true),
  )
  const epicIDs = new Set(visibleEpics.map((e) => e.id))
  const visibleTickets = data.tickets.filter(
    (t) =>
      epicIDs.has(t.epic_id) &&
      (!query ||
        `${t.title} ${t.description} TT-${t.id}`.toLowerCase().includes(query.toLowerCase())),
  )
  const listingEpics = view.type === 'epics' ? unarchivedEpics : visibleEpics
  const matchesEpic = (e: Epic) =>
    !query ||
    `${e.title} ${data.projects.find((p) => p.id === e.project_id)?.name}`
      .toLowerCase()
      .includes(query.toLowerCase())
  const filteredEpics = listingEpics.filter(matchesEpic)
  const archivedEpics = allArchivedEpics.filter(matchesEpic)
  // IDs are monotonically increasing creation order. Sort only the project
  // cards, leaving navigation, other views, and new-ticket defaults unchanged.
  if (view.type === 'project')
    filteredEpics.sort((a, b) => Number(a.completed) - Number(b.completed) || b.id - a.id)
  const boardView = view.type === 'home' || view.type === 'project' || view.type === 'epic'
  const notFound =
    loaded &&
    ((view.type === 'project' && !currentProject) ||
      (view.type === 'epic' && !currentEpic) ||
      (view.type === 'ticket' && !currentTicket))
  const activeCount = visibleEpics.filter((e) => !e.completed).length
  const parentEpic = currentEpic || ticketEpic
  const epicProject = parentEpic && data.projects.find((p) => p.id === parentEpic.project_id)
  const breadcrumbs: { label: string; view?: View }[] = [
    { label: 'Workspace', view: { type: 'home' } },
  ]
  if (view.type === 'project' || view.type === 'epic' || view.type === 'ticket') {
    breadcrumbs.push({ label: 'Projects', view: { type: 'projects' } })
    const project = currentProject || epicProject
    if (project)
      breadcrumbs.push({ label: project.name, view: { type: 'project', id: project.id } })
    if (parentEpic)
      breadcrumbs.push({ label: parentEpic.title, view: { type: 'epic', id: parentEpic.id } })
    if (currentTicket)
      breadcrumbs.push({
        label: `TT-${currentTicket.id}`,
        view: { type: 'ticket', id: currentTicket.id },
      })
    if (view.type === 'project' && view.tab === 'progress' && currentProject)
      breadcrumbs.push({ label: 'Progress', view })
    if (view.type === 'project' && view.tab === 'dependencies' && currentProject)
      breadcrumbs.push({ label: 'Dependencies', view })
    if (!loaded || notFound) breadcrumbs.push({ label: loaded ? 'Not found' : 'Loading…' })
  } else {
    breadcrumbs.push({ label: title, view })
  }

  function newTicket(status: Status = 'todo') {
    if (!data.projects.length) {
      setDialog({ type: 'project' })
      return
    }
    if (currentProject && !visibleEpics.length) {
      setDialog({ type: 'epic', projectId: currentProject.id })
      return
    }
    if (!unarchivedEpics.length) {
      setDialog({ type: 'epic', projectId: currentProject?.id })
      return
    }
    setDialog({
      type: 'ticket',
      status,
      epicId: currentEpic?.id || visibleEpics.find((e) => !e.completed)?.id || visibleEpics[0]?.id,
    })
  }

  return (
    <div className="app-shell">
      {sidebarOpen && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <button className="brand" onClick={() => navigate({ type: 'home' })}>
          <span className="brand-mark">
            <TicketIcon size={19} strokeWidth={2.2} />
          </span>
          TinyTickets<span className="local-badge">LOCAL</span>
        </button>
        <nav aria-label="Main navigation">
          <button
            className={`nav-item home-nav ${view.type === 'home' ? 'selected' : ''}`}
            onClick={() => navigate({ type: 'home' })}
          >
            <Home size={17} />
            Overview
            <span className="nav-count">
              {
                data.tickets.filter(
                  (t) =>
                    t.status !== 'done' &&
                    data.epics.some((e) => e.id === t.epic_id && !e.completed),
                ).length
              }
            </span>
          </button>
          <div className="nav-section">
            <button onClick={() => navigate({ type: 'projects' })}>
              Projects <span>{data.projects.length}</span>
            </button>
            <button
              className="icon-button"
              aria-label="New project"
              title="New project"
              onClick={() => setDialog({ type: 'project' })}
            >
              <Plus size={14} />
            </button>
          </div>
          <div className="nav-list">
            {data.projects.map((p, i) => (
              <button
                key={p.id}
                className={`nav-item ${view.type === 'project' && view.id === p.id ? 'selected' : ''}`}
                onClick={() => navigate({ type: 'project', id: p.id })}
              >
                <Folder size={16} className={`color-${i % 5}`} />
                <span className="truncate">{p.name}</span>
              </button>
            ))}
            {!data.projects.length && (
              <button className="nav-empty" onClick={() => setDialog({ type: 'project' })}>
                Create a project <Plus size={13} />
              </button>
            )}
          </div>
          <div className="nav-section">
            <button onClick={() => navigate({ type: 'epics' })}>
              Epics <span>{unarchivedEpics.length}</span>
            </button>
            <button
              className="icon-button"
              aria-label="New epic"
              title="New epic"
              onClick={() =>
                setDialog(data.projects.length ? { type: 'epic' } : { type: 'project' })
              }
            >
              <Plus size={14} />
            </button>
          </div>
          <div className="nav-list">
            {unarchivedEpics.map((e) => (
              <button
                key={e.id}
                className={`nav-item nav-epic ${view.type === 'epic' && view.id === e.id ? 'selected' : ''} ${e.completed ? 'completed-nav' : ''}`}
                onClick={() => navigate({ type: 'epic', id: e.id })}
              >
                {e.completed ? <CheckCircle2 size={16} /> : <Layers size={16} />}
                <span className="nav-epic-text">
                  <span className="truncate" title={e.title}>
                    {e.title}
                  </span>
                  <span
                    className="nav-epic-project truncate"
                    title={data.projects.find((p) => p.id === e.project_id)?.name}
                  >
                    {data.projects.find((p) => p.id === e.project_id)?.name}
                  </span>
                </span>
              </button>
            ))}
            {!unarchivedEpics.length && (
              <button
                className="nav-empty"
                onClick={() =>
                  setDialog(data.projects.length ? { type: 'epic' } : { type: 'project' })
                }
              >
                Create an epic <Plus size={13} />
              </button>
            )}
          </div>
        </nav>
        <div className="sidebar-footer">
          <span className="connection">
            <span className={`connection-dot ${connected ? 'online' : ''}`} />
            {connected ? 'Live updates' : 'Reconnecting'}
          </span>
          <div className="appearance-controls">
            <AccentPicker />
            <button
              className="icon-button theme-toggle"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
              title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
            >
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>
          </div>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div className="topbar-navigation">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu size={19} />
            </button>
            <nav className="breadcrumb" aria-label="Breadcrumb">
              <ol>
                {breadcrumbs.map((crumb, index) => (
                  <li key={crumb.view ? viewHref(crumb.view) + index : 'missing'}>
                    {index > 0 && (
                      <span className="slash" aria-hidden="true">
                        /
                      </span>
                    )}
                    {crumb.view ? (
                      <a
                        className="truncate"
                        href={viewHref(crumb.view)}
                        title={crumb.label}
                        aria-current={index === breadcrumbs.length - 1 ? 'page' : undefined}
                        onClick={(e) => {
                          if (
                            e.button === 0 &&
                            !e.metaKey &&
                            !e.ctrlKey &&
                            !e.shiftKey &&
                            !e.altKey
                          ) {
                            e.preventDefault()
                            navigate(crumb.view!)
                          }
                        }}
                      >
                        {crumb.label}
                      </a>
                    ) : (
                      <span className="truncate" aria-current="page">
                        {crumb.label}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </nav>
          </div>
          <span className="topbar-label">
            <span className="tiny-square" />
            Personal workspace
          </span>
        </header>
        {error && (
          <div className="error-banner" role="alert">
            {error}
            <button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}>
              <X size={16} />
            </button>
          </div>
        )}
        <div className="page-content">
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
                      <button
                        className="danger-text"
                        onClick={() => remove('epics', currentEpic.id)}
                      >
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
                    <button
                      className="danger-text"
                      onClick={() => remove('projects', currentProject.id)}
                    >
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
                  onClick={() =>
                    setDialog(data.projects.length ? { type: 'epic' } : { type: 'project' })
                  }
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
          {currentProject && (
            <nav className="project-tabs" aria-label="Project views">
              <a
                href={viewHref({ type: 'project', id: currentProject.id })}
                aria-current={view.type === 'project' && !view.tab ? 'page' : undefined}
              >
                Board
              </a>
              <a
                href={viewHref({ type: 'project', id: currentProject.id, tab: 'progress' })}
                aria-current={
                  view.type === 'project' && view.tab === 'progress' ? 'page' : undefined
                }
              >
                Progress
              </a>
              <a
                href={viewHref({ type: 'project', id: currentProject.id, tab: 'dependencies' })}
                aria-current={
                  view.type === 'project' && view.tab === 'dependencies' ? 'page' : undefined
                }
              >
                Dependencies
              </a>
            </nav>
          )}
          {currentEpic?.archived && (
            <p className="history-notice" role="note">
              This epic is archived. Its tickets and history are preserved. Unarchive it before
              reopening or adding tickets in the UI.
            </p>
          )}

          {!loaded ? (
            <div className="loading">
              <LoaderCircle size={20} className="spin" />
              Loading workspace
            </div>
          ) : notFound ? (
            <div className="empty-page">
              <Folder size={28} />
              <h2>Not found</h2>
              <button className="button secondary" onClick={() => navigate({ type: 'home' })}>
                <ArrowLeft size={14} />
                Back to overview
              </button>
            </div>
          ) : currentTicket ? (
            <TicketPage
              key={currentTicket.id}
              ticket={currentTicket}
              data={data}
              mutate={mutate}
              edit={() => setDialog({ type: 'ticket', item: currentTicket })}
            />
          ) : currentProject && view.type === 'project' && view.tab === 'progress' ? (
            <Suspense
              fallback={
                <div className="loading">
                  <LoaderCircle size={18} className="spin" />
                  Loading progress
                </div>
              }
            >
              <ProjectProgress
                key={currentProject.id}
                projectID={currentProject.id}
                revision={data}
              />
            </Suspense>
          ) : (
            <>
              {currentProject && view.type === 'project' && view.tab === 'dependencies' ? (
                <Suspense
                  fallback={
                    <div className="loading">
                      <LoaderCircle size={18} className="spin" />
                      Loading dependency map
                    </div>
                  }
                >
                  <DependencyMap
                    key={currentProject.id}
                    projectID={currentProject.id}
                    data={data}
                  />
                </Suspense>
              ) : view.type === 'projects' ? (
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
                          <span>
                            {unarchivedEpics.filter((e) => e.project_id === p.id).length} epics
                          </span>
                          <ArrowUpRight size={16} className="card-arrow" />
                        </button>
                      ))}
                    <button className="add-project" onClick={() => setDialog({ type: 'project' })}>
                      <FolderPlus size={20} />
                      New project
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {view.type !== 'epic' && (
                    <section
                      className="epics-section"
                      aria-label={view.type === 'epics' ? 'Active and completed epics' : undefined}
                    >
                      <div className="section-heading">
                        <h2>
                          <Layers size={17} />
                          {view.type === 'epics'
                            ? 'Active & completed epics'
                            : view.type === 'home'
                              ? 'Active epics'
                              : 'Epics'}
                          <span className="count">{listingEpics.length}</span>
                        </h2>
                        {view.type === 'epics' ? (
                          <SearchField
                            value={query}
                            onChange={setQuery}
                            placeholder="Find an epic…"
                          />
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
                      <div className="epic-grid">
                        {filteredEpics.map((e) => (
                          <EpicCard
                            key={e.id}
                            epic={e}
                            data={data}
                            onClick={() => navigate({ type: 'epic', id: e.id })}
                          />
                        ))}
                        {!listingEpics.length && (
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
                                  : view.type === 'epics' && allArchivedEpics.length
                                    ? 'No unarchived epics'
                                    : 'No epics yet'}
                              </strong>
                              <span>
                                {data.projects.length
                                  ? 'Create an epic'
                                  : 'Create your first project'}{' '}
                                <ArrowUpRight size={12} />
                              </span>
                            </span>
                            <Plus size={18} />
                          </button>
                        )}
                        {query && listingEpics.length > 0 && !filteredEpics.length && (
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
                          <div className="archived-epic-entry" key={e.id}>
                            <EpicCard
                              epic={e}
                              data={data}
                              onClick={() => navigate({ type: 'epic', id: e.id })}
                            />
                            <button
                              className="text-button"
                              disabled={busy}
                              onClick={() => archive(e, false)}
                              aria-label={`Unarchive ${e.title}`}
                            >
                              <ArchiveRestore size={14} />
                              Unarchive
                            </button>
                          </div>
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
                  {boardView && (
                    <section className="board-section">
                      <div className="section-heading board-heading">
                        <h2>
                          <TicketIcon size={17} />
                          Tickets<span className="count">{visibleTickets.length}</span>
                        </h2>
                        <div className="board-tools">
                          <SearchField
                            value={query}
                            onChange={setQuery}
                            placeholder="Search tickets…"
                          />
                          <span className="board-view-label">
                            <span className="board-symbol">▥</span>Board
                          </span>
                        </div>
                      </div>
                      <div className="board">
                        {columns.map(({ status, label, icon: Icon }) => {
                          const tickets = visibleTickets.filter((t) => t.status === status)
                          return (
                            <section
                              key={status}
                              className={`column column-${status} ${dragOver === status ? 'drag-over' : ''}`}
                              aria-label={label}
                              onDragOver={(e) => {
                                if (e.dataTransfer.types.includes('application/x-tinyticket')) {
                                  e.preventDefault()
                                  e.dataTransfer.dropEffect = 'move'
                                  setDragOver(status)
                                }
                              }}
                              onDragLeave={(e) => {
                                if (!e.currentTarget.contains(e.relatedTarget as Node))
                                  setDragOver(null)
                              }}
                              onDrop={(e) => {
                                e.preventDefault()
                                setDragOver(null)
                                move(
                                  Number(e.dataTransfer.getData('application/x-tinyticket')),
                                  status,
                                )
                              }}
                            >
                              <div className="column-heading">
                                <Icon size={15} />
                                <h3>{label}</h3>
                                <span className="column-count">{tickets.length}</span>
                                {!currentEpic?.archived && (
                                  <button
                                    className="icon-button"
                                    aria-label={`New ticket in ${label}`}
                                    onClick={() => newTicket(status)}
                                  >
                                    <Plus size={15} />
                                  </button>
                                )}
                              </div>
                              <div className="column-cards">
                                {tickets.map((ticket) => (
                                  <TicketCard
                                    key={ticket.id}
                                    ticket={ticket}
                                    data={data}
                                    onClick={() => setDialog({ type: 'ticket', item: ticket })}
                                    onDragEnd={() => setDragOver(null)}
                                  />
                                ))}
                                {!currentEpic?.archived && (
                                  <button className="add-ticket" onClick={() => newTicket(status)}>
                                    <Plus size={14} />
                                    Add ticket
                                  </button>
                                )}
                                {!tickets.length && (
                                  <div className="empty-column">
                                    {query ? 'No matches' : 'No tickets'}
                                  </div>
                                )}
                              </div>
                            </section>
                          )
                        })}
                      </div>
                      <div className="board-footer">
                        <span>
                          {activeCount} active {activeCount === 1 ? 'epic' : 'epics'}
                          <span className="footer-dot">·</span>
                          {visibleTickets.filter((t) => t.status === 'done').length} of{' '}
                          {visibleTickets.length} tickets done
                        </span>
                        <span>Drag tickets to move between columns</span>
                      </div>
                    </section>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </main>
      {dialog && (
        <Editor
          key={`${dialog.type}-${dialog.item?.id || 'new'}`}
          dialog={dialog}
          data={data}
          mutate={mutate}
          close={() => setDialog(null)}
          openTicket={(ticket) => setDialog({ type: 'ticket', item: ticket })}
          openPage={(ticket) => {
            setDialog(null)
            navigate({ type: 'ticket', id: ticket.id })
          }}
        />
      )}
    </div>
  )
}

function AccentPicker() {
  const [accent, setAccent] = useState(
    () => accents.find((a) => a.id === document.documentElement.dataset.accent) || accents[0],
  )
  const [open, setOpen] = useState(false)
  const picker = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    picker.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus()
    const outside = (e: PointerEvent) => {
      if (!picker.current?.contains(e.target as Node)) setOpen(false)
    }
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
        trigger.current?.focus()
      }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  function select(next: (typeof accents)[number]) {
    setAccent(next)
    document.documentElement.dataset.accent = next.id
    try {
      localStorage.setItem('accent', next.id)
    } catch {
      /* storage may be disabled */
    }
    setOpen(false)
    trigger.current?.focus()
  }

  return (
    <div
      className="accent-picker"
      ref={picker}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false)
      }}
    >
      <button
        className="icon-button"
        ref={trigger}
        aria-label="Choose accent color"
        title={`Accent color: ${accent.label}`}
        aria-expanded={open}
        aria-controls="accent-options"
        onClick={() => setOpen(!open)}
      >
        <span className="accent-current" />
      </button>
      {open && (
        <div className="accent-popover" id="accent-options" role="group" aria-label="Accent colors">
          <span className="accent-heading">Accent color</span>
          <div className="accent-swatches">
            {accents.map((option) => (
              <button
                key={option.id}
                className="accent-swatch"
                aria-label={option.label}
                title={option.label}
                aria-pressed={option.id === accent.id}
                onClick={() => select(option)}
              >
                <span style={{ background: option.color }}>
                  {option.id === accent.id && <Check size={13} strokeWidth={2.5} />}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (s: string) => void
  placeholder: string
}) {
  return (
    <label className="search">
      <Search size={14} />
      <input
        aria-label={placeholder.replace('…', '')}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button className="icon-button" aria-label="Clear search" onClick={() => onChange('')}>
          <X size={13} />
        </button>
      )}
    </label>
  )
}

function EpicCard({ epic, data, onClick }: { epic: Epic; data: Workspace; onClick: () => void }) {
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

function TicketCard({
  ticket,
  data,
  onClick,
  onDragEnd,
}: {
  ticket: Ticket
  data: Workspace
  onClick: () => void
  onDragEnd: () => void
}) {
  const epic = data.epics.find((e) => e.id === ticket.epic_id)
  const projectIndex = data.projects.findIndex((p) => p.id === epic?.project_id)
  const blockers = data.links.filter(
    (l) =>
      l.blocked_id === ticket.id &&
      data.tickets.find((t) => t.id === l.blocker_id)?.status !== 'done',
  )
  const links = data.links.filter((l) => l.blocked_id === ticket.id || l.blocker_id === ticket.id)
  return (
    <button
      className="ticket-card"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-tinyticket', String(ticket.id))
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragEnd={onDragEnd}
      onClick={onClick}
    >
      <div className="ticket-card-top">
        <span className="ticket-id">TT-{ticket.id}</span>
        <span className="ticket-card-indicators">
          {blockers.length > 0 && (
            <span className="blocked-badge">
              <CircleDot size={10} />
              Blocked
            </span>
          )}
          <TicketColumnTimer status={ticket.status} since={ticket.status_since} />
        </span>
      </div>
      <h4>{ticket.title}</h4>
      {ticket.description && <p className="ticket-excerpt">{ticket.description}</p>}
      <div className="ticket-card-bottom">
        <span className={`epic-label color-${projectIndex % 5}`}>
          <Layers size={11} />
          <span className="truncate">{epic?.title}</span>
        </span>
        {links.length > 0 && (
          <span className="link-count" title={`${links.length} dependencies`}>
            <Link2 size={12} />
            {links.length}
          </span>
        )}
      </div>
    </button>
  )
}

type Mutate = (path: string, method: string, body?: unknown) => Promise<unknown>
function TicketPage({
  ticket,
  data,
  mutate,
  edit,
}: {
  ticket: Ticket
  data: Workspace
  mutate: Mutate
  edit: () => void
}) {
  const epic = data.epics.find((e) => e.id === ticket.epic_id)
  const project = data.projects.find((p) => p.id === epic?.project_id)
  const links = data.links.filter((l) => l.blocker_id === ticket.id || l.blocked_id === ticket.id)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function update(body: Record<string, unknown>) {
    setSaving(true)
    setError('')
    try {
      await mutate(`tickets/${ticket.id}`, 'PATCH', body)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }
  async function restoreEpic() {
    if (!epic) return
    setSaving(true)
    setError('')
    try {
      await mutate(`epics/${epic.id}`, 'PATCH', { archived: false })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="ticket-page">
      <div className="ticket-main">
        <article className="ticket-document" aria-label="Ticket description">
          <div className="ticket-context">
            {project && (
              <a href={viewHref({ type: 'project', id: project.id })}>
                <Folder size={14} />
                {project.name}
              </a>
            )}
            {epic && (
              <a href={viewHref({ type: 'epic', id: epic.id })}>
                <Layers size={14} />
                {epic.title}
              </a>
            )}
            {epic?.archived ? (
              <>
                <span className="badge">
                  <Archive size={11} />
                  Archived epic
                </span>
                <button className="text-button" disabled={saving} onClick={restoreEpic}>
                  <ArchiveRestore size={13} />
                  Unarchive epic
                </button>
              </>
            ) : (
              epic?.completed && (
                <span className="badge">
                  <Check size={11} />
                  Completed epic
                </span>
              )
            )}
          </div>
          <div className="section-heading">
            <h2>Description</h2>
            <button className="text-button" onClick={edit}>
              <Pencil size={13} />
              Edit
            </button>
          </div>
          {ticket.description.trim() ? (
            <Suspense
              fallback={
                <p className="muted" role="status">
                  Loading description…
                </p>
              }
            >
              <MarkdownDescription source={ticket.description} />
            </Suspense>
          ) : (
            <button className="empty-description" onClick={edit}>
              Add a description…
            </button>
          )}
        </article>
        <TicketWorkLog ticketID={ticket.id} revision={data} mutate={mutate} />
      </div>
      <aside className="ticket-details" aria-label="Ticket details">
        <h2>Details</h2>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <label className="field-label">
          Status
          <select
            aria-label="Status"
            value={ticket.status}
            disabled={saving}
            onChange={(e) => update({ status: e.target.value })}
          >
            {columns.map((c) => (
              <option key={c.status} value={c.status}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label">
          Epic
          <select
            aria-label="Epic"
            value={ticket.epic_id}
            disabled={saving}
            onChange={(e) => update({ epic_id: Number(e.target.value) })}
          >
            {data.epics
              .filter((e) => !e.archived || e.id === ticket.epic_id)
              .map((e) => (
                <option key={e.id} value={e.id} disabled={e.archived}>
                  {data.projects.find((p) => p.id === e.project_id)?.name} / {e.title}
                  {e.archived ? ' (archived)' : e.completed ? ' (completed)' : ''}
                </option>
              ))}
          </select>
        </label>
        <dl className="ticket-metadata">
          <div>
            <dt>Project</dt>
            <dd>
              {project && (
                <a href={viewHref({ type: 'project', id: project.id })}>{project.name}</a>
              )}
            </dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>
              <time
                dateTime={ticket.created_at}
                title={new Date(ticket.created_at).toLocaleString()}
              >
                {new Date(ticket.created_at).toLocaleDateString()}
              </time>
            </dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>
              <time
                dateTime={ticket.updated_at}
                title={new Date(ticket.updated_at).toLocaleString()}
              >
                {new Date(ticket.updated_at).toLocaleString()}
              </time>
            </dd>
          </div>
        </dl>
        <section className="ticket-page-dependencies">
          <div className="section-heading">
            <h2>
              <Link2 size={14} />
              Dependencies<span className="count">{links.length}</span>
            </h2>
            <button className="icon-button" aria-label="Edit dependencies" onClick={edit}>
              <Plus size={14} />
            </button>
          </div>
          {links.map((link) => {
            const blockedBy = link.blocked_id === ticket.id
            const other = data.tickets.find(
              (t) => t.id === (blockedBy ? link.blocker_id : link.blocked_id),
            )
            return (
              other && (
                <a
                  className="ticket-related"
                  key={`${link.blocker_id}-${link.blocked_id}`}
                  href={viewHref({ type: 'ticket', id: other.id })}
                >
                  <span className="dependency-type">{blockedBy ? 'Blocked by' : 'Blocks'}</span>
                  <span className="ticket-related-title">
                    <span className="ticket-id">TT-{other.id}</span>
                    {other.title}
                    {other.status === 'done' && <Check size={12} />}
                  </span>
                </a>
              )
            )
          })}
          {!links.length && <span className="muted">No dependencies</span>}
        </section>
      </aside>
    </div>
  )
}

function Editor({
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
  const modal = useRef<HTMLDivElement>(null)
  const initial = useRef({ title, description, projectId, epicId, status, completed, archived })
  const changed =
    JSON.stringify(initial.current) !==
    JSON.stringify({ title, description, projectId, epicId, status, completed, archived })
  const requestClose = () => {
    if (!saving && (!changed || confirm('Discard unsaved changes?'))) close()
  }
  const closeRef = useRef(requestClose)
  closeRef.current = requestClose

  useEffect(() => {
    const previous = document.activeElement as HTMLElement
    modal.current?.querySelector<HTMLInputElement>('input')?.focus()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeRef.current()
      }
      if (e.key === 'Tab') {
        const controls = modal.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled), input, textarea, select, [tabindex="0"]',
        )
        if (!controls?.length) return
        const first = controls[0],
          last = controls[controls.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('keydown', key)
      previous?.focus()
    }
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    setError('')
    try {
      const kind =
        dialog.type === 'project' ? 'projects' : dialog.type === 'epic' ? 'epics' : 'tickets'
      const body: Record<string, unknown> =
        dialog.type === 'project'
          ? { name: title }
          : dialog.type === 'epic'
            ? { title, project_id: projectId, completed, archived }
            : { title, description, epic_id: epicId, status }
      // Do not overwrite unrelated changes made by another user or agent.
      if (item) {
        const before = initial.current
        const original: Record<string, unknown> = {
          name: before.title,
          title: before.title,
          description: before.description,
          project_id: before.projectId,
          epic_id: before.epicId,
          status: before.status,
          completed: before.completed,
          archived: before.archived,
        }
        for (const key of Object.keys(body)) if (body[key] === original[key]) delete body[key]
      }
      await mutate(`${kind}${item ? `/${item.id}` : ''}`, item ? 'PATCH' : 'POST', body)
      close()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }
  async function remove() {
    if (!item || saving || !confirm('Permanently delete this ticket and its links?')) return
    setSaving(true)
    setError('')
    try {
      await mutate(`tickets/${item.id}`, 'DELETE')
      close()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }
  async function link(method: string, link: Link) {
    setSaving(true)
    setError('')
    try {
      await mutate('links', method, link)
      setTarget('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }
  const links =
    isTicket && item
      ? data.links.filter((l) => l.blocker_id === item.id || l.blocked_id === item.id)
      : []

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose()
      }}
    >
      <div
        className={`modal ${isTicket ? 'ticket-modal' : ''}`}
        ref={modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
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
              <>
                <label className="field-label">
                  Project
                  <select
                    required
                    value={projectId}
                    onChange={(e) => setProjectId(Number(e.target.value))}
                  >
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
                {archived && (
                  <span className="form-note">Unarchive this epic before reopening it.</span>
                )}
              </>
            )}
            {isTicket && (
              <div className="field-row">
                <label className="field-label">
                  Status
                  <div className="select-wrap">
                    <select value={status} onChange={(e) => setStatus(e.target.value as Status)}>
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
                    <select
                      required
                      value={epicId}
                      onChange={(e) => setEpicId(Number(e.target.value))}
                    >
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
                      <span className="dependency-type">{blockedBy ? 'Blocked by' : 'Blocks'}</span>
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
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
