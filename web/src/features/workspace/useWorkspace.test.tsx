import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { api } from '../../shared/api'
import { useWorkspace } from './useWorkspace'

class Events extends EventTarget {
  static instances: Events[] = []
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  close = vi.fn()
  constructor() {
    super()
    Events.instances.push(this)
  }
}
const state = { projects: [], epics: [], tickets: [], links: [] }
beforeEach(() => {
  vi.useFakeTimers()
  Events.instances = []
  vi.stubGlobal('EventSource', Events)
  vi.spyOn(api, 'workspace').mockResolvedValue(state)
})
const advance = async (milliseconds = 20) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds)
  })

test('SSE initial sync makes one read instead of two and reconnect sync invalidates again', async () => {
  const { result } = renderHook(() => useWorkspace())
  act(() => {
    Events.instances[0].onopen?.()
    Events.instances[0].dispatchEvent(new Event('change'))
  })
  await advance(120)
  expect(api.workspace).toHaveBeenCalledTimes(1)
  expect(result.current.loaded).toBe(true)
  expect(result.current.connected).toBe(true)
  act(() => Events.instances[0].onerror?.())
  expect(result.current.connected).toBe(false)
  act(() => {
    Events.instances[0].onopen?.()
    Events.instances[0].dispatchEvent(new Event('change'))
  })
  await advance()
  expect(api.workspace).toHaveBeenCalledTimes(2)
  expect(result.current.revision).toBe(2)
})

test('explicit mutation refresh and its SSE event coalesce, including log-only changes', async () => {
  const { result } = renderHook(() => useWorkspace())
  act(() => Events.instances[0].dispatchEvent(new Event('change')))
  await advance()
  let refreshed!: Promise<void>
  act(() => {
    Events.instances[0].dispatchEvent(new Event('change'))
    refreshed = result.current.refresh()
  })
  await advance()
  await refreshed
  expect(api.workspace).toHaveBeenCalledTimes(2)
  expect(result.current.revision).toBe(2)
})

test('buffered SSE falls back, with polling and visible-tab catchup', async () => {
  const { result } = renderHook(() => useWorkspace())
  await advance(120)
  expect(result.current.loaded).toBe(true)
  expect(api.workspace).toHaveBeenCalledTimes(1)
  await advance(15000)
  expect(api.workspace).toHaveBeenCalledTimes(2)
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('focus'))
  })
  await advance()
  expect(api.workspace).toHaveBeenCalledTimes(3)
})

test('unmount aborts pending snapshots and closes resources; remount can load again', async () => {
  let signal: AbortSignal | undefined
  vi.mocked(api.workspace).mockImplementationOnce((incoming) => {
    signal = incoming
    return new Promise(() => {})
  })
  const first = renderHook(() => useWorkspace())
  act(() => Events.instances[0].dispatchEvent(new Event('change')))
  await advance()
  first.unmount()
  expect(signal?.aborted).toBe(true)
  expect(Events.instances[0].close).toHaveBeenCalledOnce()
  await advance(20000)
  expect(api.workspace).toHaveBeenCalledTimes(1)
  const second = renderHook(() => useWorkspace())
  act(() => Events.instances[1].dispatchEvent(new Event('change')))
  await advance()
  expect(second.result.current.loaded).toBe(true)
})

test('read failures expose retryable errors without retrying writes or reads automatically', async () => {
  vi.mocked(api.workspace).mockRejectedValueOnce(new Error('offline'))
  const { result } = renderHook(() => useWorkspace())
  await advance(120)
  expect(result.current.error).toBe('offline')
  expect(result.current.loaded).toBe(false)
  let refreshed!: Promise<void>
  act(() => {
    refreshed = result.current.refresh()
  })
  await advance()
  await refreshed
  expect(result.current.error).toBe('')
  expect(result.current.loaded).toBe(true)
})
