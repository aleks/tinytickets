export type Project = { id: number; name: string }
export type Epic = {
  id: number
  project_id: number
  title: string
  completed: boolean
  archived: boolean
}
export type Status = 'todo' | 'in_progress' | 'ready_for_review' | 'done'
export type Ticket = {
  id: number
  epic_id: number
  title: string
  description: string
  status: Status
  created_at: string
  updated_at: string
  status_since: string | null
}
export type Link = { blocker_id: number; blocked_id: number }
export type Workspace = { projects: Project[]; epics: Epic[]; tickets: Ticket[]; links: Link[] }

export type CreateProjectInput = Pick<Project, 'name'>
export type UpdateProjectInput = Partial<CreateProjectInput>
export type CreateEpicInput = Pick<Epic, 'title' | 'project_id'> &
  Partial<Pick<Epic, 'completed' | 'archived'>>
export type UpdateEpicInput = Partial<CreateEpicInput>
export type CreateTicketInput = Pick<Ticket, 'title' | 'epic_id'> &
  Partial<Pick<Ticket, 'description' | 'status'>>
export type UpdateTicketInput = Partial<CreateTicketInput>
export type DeleteResult = { id: number }
export type DeletionKind = 'projects' | 'epics' | 'tickets'
export type DeletionOptions = { force?: boolean; confirmation_token?: string }
export type DeletionPreview = {
  kind: DeletionKind
  id: number
  name: string
  requires_force: boolean
  confirmation_token: string
  counts: {
    epics: number
    tickets: number
    archived_epics: number
    work_log_entries: number
    status_events: number
    dependency_links: number
    external_dependency_links: number
  }
}
export type WorkLogEntry = {
  id: number
  ticket_id: number
  kind: 'note' | 'review_handoff'
  author: string
  body: string
  verification: string
  references: string
  review_notes: string
  created_at: string
}
export type WorkLogResult = { ticket_id: number; entries: WorkLogEntry[] }
export type WorkLogInput = { body: string; author?: string }
export type ReviewHandoffInput = {
  summary: string
  verification: string
  references?: string
  review_notes?: string
  author?: string
}
export type ReviewHandoffResult = { entry: WorkLogEntry; ticket: Ticket }

// Execution endpoints return projections, not complete workspace entities.
export type ExecutionSegment = { status: Status; start: string; end: string; ongoing: boolean }
export type TicketTiming = {
  ticket: Pick<Ticket, 'id' | 'title' | 'status'>
  history_complete: boolean
  observed_from: string | null
  timing_state: 'observed' | 'not_started' | 'unavailable'
  started_at: string | null
  completed_at: string | null
  cycle_seconds: number | null
  active_age_seconds: number | null
  in_progress_seconds: number
  review_seconds: number
  segments: ExecutionSegment[]
}
export type ExecutionMetrics = {
  total: number
  completed: number
  active: number
  blocked: number
  not_started: number
  partial_history: number
  timing_unavailable: number
  status_counts: Record<Status, number>
  in_progress_seconds: number
  review_seconds: number
  median_completion_seconds: number | null
  completion_samples: number
  oldest_active_age_seconds: number | null
  active_age_samples: number
}
export type EpicTiming = {
  epic: Pick<Epic, 'id' | 'title' | 'completed' | 'archived'>
  metrics: ExecutionMetrics
  tickets: TicketTiming[]
}
export type CompletionBucket = { date: string; tickets: number }
export type ProjectExecution = {
  project: Project
  generated_at: string
  metrics: ExecutionMetrics
  epics_total: number
  epics_completed: number
  epics_archived: number
  epics: EpicTiming[]
  daily_completions: CompletionBucket[]
  weekly_completions: CompletionBucket[]
}
