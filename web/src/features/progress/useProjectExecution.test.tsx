import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { api } from '../../shared/api'
import type { ProjectExecution } from '../../shared/types'
import { useProjectExecution } from './useProjectExecution'

// Only identity is relevant to these lifecycle tests; the report rendering is
// exercised against complete server responses by the isolated browser suite.
function report(id: number): ProjectExecution {
  return {
    project: { id, name: 'Project' },
    generated_at: '2026-11-11T10:00:00Z',
    epics: [],
    epics_total: 0,
    epics_completed: 0,
    epics_archived: 0,
    daily_completions: [],
    weekly_completions: [],
    metrics: {
      total: 0,
      completed: 0,
      active: 0,
      blocked: 0,
      not_started: 0,
      partial_history: 0,
      timing_unavailable: 0,
      status_counts: { todo: 0, in_progress: 0, ready_for_review: 0, done: 0 },
      in_progress_seconds: 0,
      review_seconds: 0,
      median_completion_seconds: null,
      completion_samples: 0,
      oldest_active_age_seconds: null,
      active_age_samples: 0,
    },
  }
}

test('out-of-order project results are ignored and reads are canceled on cleanup', async () => {
  let resolve!: (value: ProjectExecution) => void
  const get = vi
    .spyOn(api, 'projectExecution')
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    .mockResolvedValue(report(2))
  const { result, rerender, unmount } = renderHook(({ id }) => useProjectExecution(id, 0), {
    initialProps: { id: 1 },
  })
  rerender({ id: 2 })
  expect(get.mock.calls[0][1]?.aborted).toBe(true)
  await waitFor(() => expect(result.current.report?.project.id).toBe(2))
  await act(async () => resolve(report(1)))
  expect(result.current.report?.project.id).toBe(2)
  unmount()
  expect(get.mock.calls[1][1]?.aborted).toBe(true)
})

test('failed refreshes retain the report, and retries recover without a reload', async () => {
  vi.spyOn(api, 'projectExecution')
    .mockResolvedValueOnce(report(1))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue(report(1))
  const { result, rerender } = renderHook(({ revision }) => useProjectExecution(1, revision), {
    initialProps: { revision: 0 },
  })
  await waitFor(() => expect(result.current.report).not.toBeNull())
  rerender({ revision: 1 })
  await waitFor(() => expect(result.current.error).toBe('offline'))
  expect(result.current.report?.project.id).toBe(1)
  act(() => result.current.retry())
  await waitFor(() => expect(result.current.error).toBe(''))
})
