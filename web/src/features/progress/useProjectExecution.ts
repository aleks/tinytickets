import { useCallback, useEffect, useState } from 'react'
import { api, errorMessage } from '../../shared/api'
import type { ProjectExecution } from '../../shared/types'

export function useProjectExecution(projectID: number, revision: unknown) {
  const [state, setState] = useState({
    projectID,
    report: null as ProjectExecution | null,
    receivedAt: 0,
    error: '',
  })
  const [reload, setReload] = useState(0)
  const retry = useCallback(() => setReload((value) => value + 1), [])
  useEffect(() => {
    const controller = new AbortController()
    api.projectExecution(projectID, controller.signal).then(
      (report) => {
        if (!controller.signal.aborted)
          setState({ projectID, report, receivedAt: Date.now(), error: '' })
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setState((previous) => ({
            projectID,
            report: previous.projectID === projectID ? previous.report : null,
            receivedAt: previous.projectID === projectID ? previous.receivedAt : 0,
            error: errorMessage(error, 'Unable to load project execution'),
          }))
      },
    )
    return () => controller.abort()
  }, [projectID, revision, reload])
  return {
    ...(state.projectID === projectID ? state : { report: null, receivedAt: 0, error: '' }),
    retry,
  }
}
