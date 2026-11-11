import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { api } from '../../shared/api'
import type { WorkLogEntry, WorkLogResult } from '../../shared/types'
import { useTicketWorkLog } from './useTicketWorkLog'

const entry = (id: number, ticketID = 1): WorkLogEntry => ({
  id,
  ticket_id: ticketID,
  kind: 'note',
  author: '',
  body: 'Note',
  verification: '',
  references: '',
  review_notes: '',
  created_at: '2026-11-11T10:00:00Z',
})

test('late reads cannot erase accepted immutable entries; invalidation is not keyed to updated_at', async () => {
  let resolve!: (result: WorkLogResult) => void
  vi.spyOn(api, 'workLog')
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    .mockResolvedValue({ ticket_id: 1, entries: [entry(1), entry(2)] })
  const { result, rerender } = renderHook(({ revision }) => useTicketWorkLog(1, revision), {
    initialProps: { revision: 0 },
  })
  act(() => result.current.accept(entry(2)))
  await act(async () => resolve({ ticket_id: 1, entries: [entry(1)] }))
  expect(result.current.entries.map((e) => e.id)).toEqual([1, 2])
  rerender({ revision: 1 })
  await waitFor(() => expect(api.workLog).toHaveBeenCalledTimes(2))
  expect(result.current.entries.map((e) => e.id)).toEqual([1, 2])
})

test('changing tickets cancels stale reads and does not leak another ticket log', async () => {
  let resolve!: (result: WorkLogResult) => void
  const get = vi
    .spyOn(api, 'workLog')
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    .mockResolvedValue({ ticket_id: 2, entries: [entry(3, 2)] })
  const { result, rerender, unmount } = renderHook(({ id }) => useTicketWorkLog(id, 0), {
    initialProps: { id: 1 },
  })
  const signal = get.mock.calls[0][1]
  rerender({ id: 2 })
  expect(signal?.aborted).toBe(true)
  await waitFor(() => expect(result.current.entries[0]?.ticket_id).toBe(2))
  await act(async () => resolve({ ticket_id: 1, entries: [entry(1)] }))
  expect(result.current.entries.map((e) => e.id)).toEqual([3])
  const latestSignal = get.mock.calls[1][1]
  unmount()
  expect(latestSignal?.aborted).toBe(true)
})

test('read failures preserve known entries and expose a retry', async () => {
  vi.spyOn(api, 'workLog')
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ ticket_id: 1, entries: [entry(1)] })
  const { result } = renderHook(() => useTicketWorkLog(1, 0))
  await waitFor(() => expect(result.current.error).toBe('offline'))
  act(() => result.current.retry())
  await waitFor(() => expect(result.current.loaded).toBe(true))
  expect(result.current.error).toBe('')
})
