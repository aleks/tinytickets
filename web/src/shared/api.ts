import type {
  CreateEpicInput,
  CreateProjectInput,
  CreateTicketInput,
  DeleteResult,
  DeletionKind,
  DeletionOptions,
  DeletionPreview,
  Epic,
  Link,
  Project,
  ProjectExecution,
  ReviewHandoffInput,
  ReviewHandoffResult,
  Ticket,
  UpdateEpicInput,
  UpdateProjectInput,
  UpdateTicketInput,
  WorkLogEntry,
  WorkLogInput,
  WorkLogResult,
  Workspace,
} from './types'

export function errorMessage(error: unknown, fallback = 'Request failed'): string {
  return error instanceof Error && error.message
    ? error.message
    : typeof error === 'string' && error
      ? error
      : fallback
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

// One attempt only, including writes: a failed connection may already have committed.
async function request<T>(
  path: string,
  method = 'GET',
  body?: object,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })
  let data: unknown
  try {
    data = await response.json()
  } catch (error) {
    if (
      signal?.aborted ||
      (typeof error === 'object' &&
        error !== null &&
        'name' in error &&
        error.name === 'AbortError')
    )
      throw error
    if (!response.ok)
      throw new ApiError(
        `Request failed (${response.status}${response.statusText ? ` ${response.statusText}` : ''})`,
        response.status,
      )
    throw new ApiError('Invalid JSON response', response.status)
  }
  if (!response.ok) {
    const message =
      typeof data === 'object' &&
      data !== null &&
      'error' in data &&
      typeof data.error === 'string' &&
      data.error
        ? data.error
        : `Request failed (${response.status}${response.statusText ? ` ${response.statusText}` : ''})`
    throw new ApiError(message, response.status)
  }
  // The server owns schema validation; the transport assertion stays at this boundary.
  return data as T
}

export const api = {
  deletionPreview: (kind: DeletionKind, id: number, signal?: AbortSignal) =>
    request<DeletionPreview>(`${kind}/${id}/deletion-preview`, 'GET', undefined, signal),
  deleteResource: (
    kind: DeletionKind,
    id: number,
    options?: DeletionOptions,
    signal?: AbortSignal,
  ) => request<DeleteResult>(`${kind}/${id}`, 'DELETE', options, signal),
  workspace: (signal?: AbortSignal) => request<Workspace>('state', 'GET', undefined, signal),
  projectExecution: (id: number, signal?: AbortSignal) =>
    request<ProjectExecution>(`projects/${id}/execution`, 'GET', undefined, signal),
  workLog: (id: number, signal?: AbortSignal) =>
    request<WorkLogResult>(`tickets/${id}/work-log`, 'GET', undefined, signal),
  createProject: (body: CreateProjectInput, signal?: AbortSignal) =>
    request<Project>('projects', 'POST', body, signal),
  updateProject: (id: number, body: UpdateProjectInput, signal?: AbortSignal) =>
    request<Project>(`projects/${id}`, 'PATCH', body, signal),
  deleteProject: (id: number, signal?: AbortSignal) =>
    request<DeleteResult>(`projects/${id}`, 'DELETE', undefined, signal),
  createEpic: (body: CreateEpicInput, signal?: AbortSignal) =>
    request<Epic>('epics', 'POST', body, signal),
  updateEpic: (id: number, body: UpdateEpicInput, signal?: AbortSignal) =>
    request<Epic>(`epics/${id}`, 'PATCH', body, signal),
  deleteEpic: (id: number, signal?: AbortSignal) =>
    request<DeleteResult>(`epics/${id}`, 'DELETE', undefined, signal),
  createTicket: (body: CreateTicketInput, signal?: AbortSignal) =>
    request<Ticket>('tickets', 'POST', body, signal),
  updateTicket: (id: number, body: UpdateTicketInput, signal?: AbortSignal) =>
    request<Ticket>(`tickets/${id}`, 'PATCH', body, signal),
  deleteTicket: (id: number, signal?: AbortSignal) =>
    request<DeleteResult>(`tickets/${id}`, 'DELETE', undefined, signal),
  createLink: (body: Link, signal?: AbortSignal) => request<Link>('links', 'POST', body, signal),
  deleteLink: (body: Link, signal?: AbortSignal) => request<Link>('links', 'DELETE', body, signal),
  addWorkLog: (id: number, body: WorkLogInput, signal?: AbortSignal) =>
    request<WorkLogEntry>(`tickets/${id}/work-log`, 'POST', body, signal),
  createReviewHandoff: (id: number, body: ReviewHandoffInput, signal?: AbortSignal) =>
    request<ReviewHandoffResult>(`tickets/${id}/review-handoff`, 'POST', body, signal),
}

export type Mutate = <T>(operation: Promise<T>) => Promise<T>
