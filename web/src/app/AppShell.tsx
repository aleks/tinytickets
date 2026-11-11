import { useEffect, useRef, useState } from 'react'
import {
  Check,
  CheckCircle2,
  Folder,
  Home,
  Layers,
  Menu,
  Moon,
  Plus,
  Sun,
  Ticket as TicketIcon,
  X,
} from 'lucide-react'
import type { Epic, Workspace } from '../shared/types'
import { viewHref, type View } from './routing'
import type { Dialog } from '../features/editor/dialog'

const accents = [
  { id: 'sage', label: 'Sage', color: '#3c6957' },
  { id: 'slate', label: 'Slate', color: '#526c80' },
  { id: 'lavender', label: 'Lavender', color: '#786388' },
  { id: 'clay', label: 'Clay', color: '#916956' },
  { id: 'sand', label: 'Sand', color: '#85713e' },
] as const

export function AppShell({
  children,
  overlay,
  sidebarOpen,
  setSidebarOpen,
  view,
  navigate,
  data,
  unarchivedEpics,
  setDialog,
  connected,
  theme,
  toggleTheme,
  breadcrumbs,
  error,
  setError,
}: {
  children: React.ReactNode
  overlay: React.ReactNode
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  view: View
  navigate: (view: View) => void
  data: Workspace
  unarchivedEpics: Epic[]
  setDialog: (dialog: Dialog) => void
  connected: boolean
  theme: string
  toggleTheme: () => void
  breadcrumbs: { label: string; view?: View }[]
  error: string
  setError: (error: string) => void
}) {
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
        <div className="page-content">{children}</div>
      </main>
      {overlay}
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
