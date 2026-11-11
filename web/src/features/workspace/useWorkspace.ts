import { useCallback, useEffect, useRef, useState } from 'react'
import { api, errorMessage } from '../../shared/api'
import type { Workspace } from '../../shared/types'
import { createRefreshQueue } from './refreshQueue'

const empty: Workspace = { projects: [], epics: [], tickets: [], links: [] }

export function useWorkspace() {
  const [data, setData] = useState<Workspace>(empty)
  const [loaded, setLoaded] = useState(false)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const queue = useRef<ReturnType<typeof createRefreshQueue> | null>(null)

  const refresh = useCallback(() => queue.current?.invalidate() ?? Promise.resolve(), [])
  const clearError = useCallback(() => setError(''), [])

  useEffect(() => {
    const reads = createRefreshQueue(
      async (signal) => {
        const next = await api.workspace(signal)
        if (signal.aborted) return
        setData(next)
        setLoaded(true)
        setError('')
        // Log-only writes leave ticket.updated_at unchanged. Revisions represent
        // successful workspace invalidations, not just ticket-field changes.
        setRevision((value) => value + 1)
      },
      (failure) => setError(errorMessage(failure)),
    )
    queue.current = reads
    // The server sends a sync change on every connection. Let that bootstrap the
    // first read; a short fallback handles unavailable/buffered SSE without the
    // previous unconditional initial-read + initial-SSE-read duplication.
    const bootstrap = setTimeout(() => void reads.invalidate(), 100)
    let events: EventSource | undefined
    try {
      events = new EventSource('/api/events')
      events.onopen = () => setConnected(true)
      events.onerror = () => setConnected(false)
      events.addEventListener('change', () => {
        clearTimeout(bootstrap)
        void reads.invalidate()
      })
    } catch {
      clearTimeout(bootstrap)
      void reads.invalidate()
    }
    const poll = setInterval(() => void reads.invalidate(), 15000)
    const wake = () => {
      if (!document.hidden) void reads.invalidate()
    }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('focus', wake)
    return () => {
      clearTimeout(bootstrap)
      clearInterval(poll)
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('focus', wake)
      events?.close()
      reads.dispose()
      if (queue.current === reads) queue.current = null
    }
  }, [])

  return { data, loaded, connected, error, revision, refresh, clearError }
}
