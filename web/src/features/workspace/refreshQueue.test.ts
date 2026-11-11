import { afterEach, expect, test, vi } from 'vitest'
import { createRefreshQueue } from './refreshQueue'

afterEach(() => vi.useRealTimers())

test('coalesces a burst into one read and resolves every caller', async () => {
  vi.useFakeTimers()
  const load = vi.fn().mockResolvedValue(undefined)
  const queue = createRefreshQueue(load, vi.fn())
  const requests = [queue.invalidate(), queue.invalidate(), queue.invalidate()]
  await vi.advanceTimersByTimeAsync(20)
  await Promise.all(requests)
  expect(load).toHaveBeenCalledTimes(1)
  queue.dispose()
})

test('events during an in-flight snapshot cause one safe trailing read', async () => {
  vi.useFakeTimers()
  let finish!: () => void
  const load = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    .mockResolvedValue(undefined)
  const queue = createRefreshQueue(load, vi.fn())
  const first = queue.invalidate()
  await vi.advanceTimersByTimeAsync(20)
  const later = [queue.invalidate(), queue.invalidate()]
  await vi.advanceTimersByTimeAsync(100)
  expect(load).toHaveBeenCalledTimes(1)
  finish()
  await first
  await vi.advanceTimersByTimeAsync(20)
  await Promise.all(later)
  expect(load).toHaveBeenCalledTimes(2)
  queue.dispose()
})

test('does not retry failed reads without a new invalidation', async () => {
  vi.useFakeTimers()
  const error = new Error('offline'),
    report = vi.fn()
  const load = vi.fn().mockRejectedValue(error)
  const queue = createRefreshQueue(load, report)
  const pending = queue.invalidate()
  await vi.advanceTimersByTimeAsync(100)
  await pending
  expect(report).toHaveBeenCalledWith(error)
  expect(load).toHaveBeenCalledTimes(1)
  queue.dispose()
})

test('disposal aborts active reads and cancels scheduled work', async () => {
  vi.useFakeTimers()
  let signal!: AbortSignal
  const report = vi.fn()
  const load = vi.fn().mockImplementation((incoming: AbortSignal) => {
    signal = incoming
    return new Promise<void>((_, reject) =>
      incoming.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))),
    )
  })
  const queue = createRefreshQueue(load, report)
  const first = queue.invalidate()
  await vi.advanceTimersByTimeAsync(20)
  const trailing = queue.invalidate()
  queue.dispose()
  await Promise.all([first, trailing])
  await vi.advanceTimersByTimeAsync(100)
  expect(signal.aborted).toBe(true)
  expect(report).not.toHaveBeenCalled()
  expect(load).toHaveBeenCalledTimes(1)
  await queue.invalidate()
})
