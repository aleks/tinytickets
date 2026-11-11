import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, errorMessage } from './api'

afterEach(() => vi.unstubAllGlobals())

function respond(body: unknown, status = 200) {
  const fetchMock = vi
    .fn()
    .mockImplementation(() => Promise.resolve(new Response(JSON.stringify(body), { status })))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('typed endpoint contracts', () => {
  it('loads workspace, work log, and execution using the existing URLs and signals', async () => {
    const workspace = { projects: [], epics: [], tickets: [], links: [] }
    const fetchMock = respond(workspace)
    const signal = new AbortController().signal
    expect(await api.workspace(signal)).toEqual(workspace)
    await api.workLog(7, signal)
    await api.projectExecution(3, signal)
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/state',
      '/api/tickets/7/work-log',
      '/api/projects/3/execution',
    ])
    for (const [, options] of fetchMock.mock.calls) {
      expect(options).toEqual({ method: 'GET', headers: {}, body: undefined, signal })
    }
  })

  it('preserves mutation methods, bodies, and endpoint-specific responses', async () => {
    const result = { id: 7 }
    const fetchMock = respond(result)
    const signal = new AbortController().signal
    const link = { blocker_id: 7, blocked_id: 8 }
    const note = { body: 'Progress', author: 'Agent' }
    const handoff = {
      summary: 'Changed',
      verification: 'Passed',
      references: 'abc',
      review_notes: 'Check',
      author: 'Agent',
    }
    const cases: [() => Promise<object>, string, string, object | undefined][] = [
      [
        () => api.createProject({ name: 'Project' }, signal),
        'projects',
        'POST',
        { name: 'Project' },
      ],
      [() => api.updateProject(7, {}, signal), 'projects/7', 'PATCH', {}],
      [() => api.deleteProject(7, signal), 'projects/7', 'DELETE', undefined],
      [
        () =>
          api.createEpic(
            { project_id: 3, title: 'Epic', completed: false, archived: false },
            signal,
          ),
        'epics',
        'POST',
        { project_id: 3, title: 'Epic', completed: false, archived: false },
      ],
      [
        () => api.updateEpic(7, { archived: false }, signal),
        'epics/7',
        'PATCH',
        { archived: false },
      ],
      [() => api.deleteEpic(7, signal), 'epics/7', 'DELETE', undefined],
      [
        () =>
          api.createTicket(
            { epic_id: 4, title: 'Ticket', description: '', status: 'todo' },
            signal,
          ),
        'tickets',
        'POST',
        { epic_id: 4, title: 'Ticket', description: '', status: 'todo' },
      ],
      [
        () => api.updateTicket(7, { status: 'done' }, signal),
        'tickets/7',
        'PATCH',
        { status: 'done' },
      ],
      [() => api.deleteTicket(7, signal), 'tickets/7', 'DELETE', undefined],
      [() => api.createLink(link, signal), 'links', 'POST', link],
      [() => api.deleteLink(link, signal), 'links', 'DELETE', link],
      [() => api.addWorkLog(7, note, signal), 'tickets/7/work-log', 'POST', note],
      [
        () => api.createReviewHandoff(7, handoff, signal),
        'tickets/7/review-handoff',
        'POST',
        handoff,
      ],
    ]
    for (const [operation, path, method, body] of cases) {
      expect(await operation()).toEqual(result)
      expect(fetchMock).toHaveBeenLastCalledWith(`/api/${path}`, {
        method,
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      })
    }
    expect(fetchMock).toHaveBeenCalledTimes(cases.length)
  })
})

describe('transport failures', () => {
  it('reports JSON server errors with their HTTP status', async () => {
    respond({ error: 'Move contained tickets first' }, 409)
    await expect(api.deleteEpic(7)).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
      message: 'Move contained tickets first',
    })
  })

  it.each(['<html>Bad gateway</html>', '', '{ broken'])(
    'reports non-JSON HTTP errors without leaking parser errors: %j',
    async (body) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response(body, { status: 502, statusText: 'Bad Gateway' }))
      vi.stubGlobal('fetch', fetchMock)
      await expect(api.createTicket({ epic_id: 1, title: 'Ticket' })).rejects.toMatchObject({
        status: 502,
        message: 'Request failed (502 Bad Gateway)',
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    },
  )

  it.each([null, { error: 3 }, { error: '' }])(
    'handles unexpected JSON error bodies: %j',
    async (body) => {
      respond(body, 400)
      await expect(api.workspace()).rejects.toThrow('Request failed (400)')
    },
  )

  it('rejects malformed successful responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not JSON')))
    await expect(api.workspace()).rejects.toBeInstanceOf(ApiError)
    await expect(api.workspace()).rejects.toThrow('Invalid JSON response')
  })

  it('preserves network failures and never retries writes', async () => {
    const error = new TypeError('Failed to fetch')
    const fetchMock = vi.fn().mockRejectedValue(error)
    vi.stubGlobal('fetch', fetchMock)
    await expect(api.addWorkLog(7, { body: 'Append once' })).rejects.toBe(error)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('forwards cancellation and preserves fetch abort errors', async () => {
    const controller = new AbortController()
    controller.abort()
    const error = new DOMException('Aborted', 'AbortError')
    const fetchMock = vi.fn().mockRejectedValue(error)
    vi.stubGlobal('fetch', fetchMock)
    await expect(api.workLog(7, controller.signal)).rejects.toBe(error)
    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not turn response-body cancellation into a JSON or HTTP error', async () => {
    const error = new DOMException('Aborted', 'AbortError')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 503, json: vi.fn().mockRejectedValue(error) }),
    )
    await expect(api.workspace()).rejects.toBe(error)
  })

  it('safely formats arbitrary caught values', () => {
    expect(errorMessage(new Error('Server error'))).toBe('Server error')
    expect(errorMessage('Connection failed')).toBe('Connection failed')
    for (const error of [null, undefined, {}, 42, new Error(''), '']) {
      expect(errorMessage(error, 'Unable to save')).toBe('Unable to save')
    }
  })
})
