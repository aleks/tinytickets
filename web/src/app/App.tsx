import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Folder, LoaderCircle } from 'lucide-react'
import { api, errorMessage } from '../shared/api'
import type { Epic, Status, Workspace } from '../shared/types'
import { initialView, viewHref, type View } from './routing'
import { AppShell } from './AppShell'
import { PageHeading } from './PageHeading'
import { Editor } from '../features/editor/Editor'
import type { Dialog } from '../features/editor/dialog'
import { TicketPage } from '../features/tickets/TicketPage'
import { ProjectList } from '../features/projects/ProjectList'
import { EpicList } from '../features/projects/EpicList'
import { Board } from '../features/board/Board'
import {
  indexWorkspace,
  selectVisibleEpics,
  selectVisibleTickets,
} from '../features/workspace/selectors'

const empty: Workspace = { projects: [], epics: [], tickets: [], links: [] }

const ProjectProgress = lazy(() =>
  import('../features/progress/ProjectProgress').then((module) => ({
    default: module.ProjectProgress,
  })),
)
const DependencyMap = lazy(() =>
  import('../features/dependencies/DependencyMap').then((module) => ({
    default: module.DependencyMap,
  })),
)

export function App() {
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
      const next = await api.workspace()
      if (n === requestNumber.current) {
        setData(next)
        setLoaded(true)
      }
    } catch (err) {
      if (n === requestNumber.current) setError(errorMessage(err))
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
  async function mutate<T>(operation: Promise<T>): Promise<T> {
    const result = await operation
    await refresh()
    return result
  }
  async function move(id: number, status: Status) {
    const ticket = data.tickets.find((t) => t.id === id)
    if (!ticket || ticket.status === status) return
    try {
      await mutate(api.updateTicket(id, { status }))
    } catch (err) {
      setError(errorMessage(err))
    }
  }
  async function complete(epic: Epic) {
    if (busy) return
    setBusy(true)
    try {
      await mutate(api.updateEpic(epic.id, { completed: !epic.completed }))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  async function archive(epic: Epic, archived: boolean) {
    if (busy) return
    setBusy(true)
    try {
      await mutate(api.updateEpic(epic.id, { archived }))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  async function remove(kind: 'projects' | 'epics', id: number) {
    if (!confirm(`Delete this ${kind === 'projects' ? 'project' : 'epic'}? It must be empty.`))
      return
    try {
      await mutate(kind === 'projects' ? api.deleteProject(id) : api.deleteEpic(id))
      navigate({ type: kind })
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const index = indexWorkspace(data)
  const currentProject = view.type === 'project' ? index.projects.get(view.id) : undefined
  const currentEpic = view.type === 'epic' ? index.epics.get(view.id) : undefined
  const currentTicket = view.type === 'ticket' ? index.tickets.get(view.id) : undefined
  const ticketEpic = currentTicket && index.epics.get(currentTicket.epic_id)
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
  const visibleEpics = selectVisibleEpics(data, view)
  const epicIDs = new Set(visibleEpics.map((e) => e.id))
  const visibleTickets = selectVisibleTickets(data, epicIDs, query)
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
    <AppShell
      sidebarOpen={sidebarOpen}
      setSidebarOpen={setSidebarOpen}
      view={view}
      navigate={navigate}
      data={data}
      unarchivedEpics={unarchivedEpics}
      setDialog={setDialog}
      connected={connected}
      theme={theme}
      toggleTheme={toggleTheme}
      breadcrumbs={breadcrumbs}
      error={error}
      setError={setError}
      overlay={
        dialog && (
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
        )
      }
    >
      <PageHeading
        currentTicket={currentTicket}
        currentEpic={currentEpic}
        currentProject={currentProject}
        title={title}
        view={view}
        busy={busy}
        archive={archive}
        complete={complete}
        remove={remove}
        setDialog={setDialog}
        data={data}
        notFound={notFound}
        newTicket={newTicket}
      />
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
            aria-current={view.type === 'project' && view.tab === 'progress' ? 'page' : undefined}
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
          <ProjectProgress key={currentProject.id} projectID={currentProject.id} revision={data} />
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
              <DependencyMap key={currentProject.id} projectID={currentProject.id} data={data} />
            </Suspense>
          ) : view.type === 'projects' ? (
            <ProjectList
              data={data}
              unarchivedEpics={unarchivedEpics}
              query={query}
              setQuery={setQuery}
              navigate={navigate}
              setDialog={setDialog}
            />
          ) : (
            <>
              <EpicList
                view={view}
                data={data}
                query={query}
                setQuery={setQuery}
                setDialog={setDialog}
                currentProject={currentProject}
                listingEpics={listingEpics}
                filteredEpics={filteredEpics}
                allArchivedEpics={allArchivedEpics}
                archivedEpics={archivedEpics}
                navigate={navigate}
                busy={busy}
                archive={archive}
              />
              {boardView && (
                <Board
                  visibleTickets={visibleTickets}
                  query={query}
                  setQuery={setQuery}
                  dragOver={dragOver}
                  setDragOver={setDragOver}
                  move={move}
                  currentEpic={currentEpic}
                  newTicket={newTicket}
                  data={data}
                  setDialog={setDialog}
                  activeCount={activeCount}
                />
              )}
            </>
          )}
        </>
      )}
    </AppShell>
  )
}
