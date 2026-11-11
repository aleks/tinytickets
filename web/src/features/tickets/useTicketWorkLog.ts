import { useCallback, useEffect, useState } from 'react'
import { api, errorMessage } from '../../shared/api'
import type { WorkLogEntry } from '../../shared/types'

function mergeEntries(previous: WorkLogEntry[], next: WorkLogEntry[]) {
  return [...new Map([...previous, ...next].map((entry) => [entry.id, entry])).values()].sort(
    (a, b) => a.id - b.id,
  )
}

export function useTicketWorkLog(ticketID: number, revision: unknown) {
  const [state, setState] = useState({
    ticketID,
    entries: [] as WorkLogEntry[],
    loaded: false,
    error: '',
  })
  const [reload, setReload] = useState(0)
  const retry = useCallback(() => setReload((value) => value + 1), [])
  const accept = useCallback(
    (entry: WorkLogEntry) => {
      if (entry.ticket_id !== ticketID) return
      setState((previous) => ({
        ticketID,
        loaded: true,
        error: previous.ticketID === ticketID ? previous.error : '',
        entries: mergeEntries(previous.ticketID === ticketID ? previous.entries : [], [entry]),
      }))
    },
    [ticketID],
  )

  useEffect(() => {
    const controller = new AbortController()
    api.workLog(ticketID, controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return
        setState((previous) => ({
          ticketID,
          entries: mergeEntries(
            previous.ticketID === ticketID ? previous.entries : [],
            result.entries,
          ),
          loaded: true,
          error: '',
        }))
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        setState((previous) => ({
          ticketID,
          entries: previous.ticketID === ticketID ? previous.entries : [],
          loaded: previous.ticketID === ticketID && previous.loaded,
          error: errorMessage(error, 'Could not load work log'),
        }))
      },
    )
    return () => controller.abort()
  }, [ticketID, revision, reload])

  const current = state.ticketID === ticketID ? state : { entries: [], loaded: false, error: '' }
  return { ...current, retry, accept }
}
