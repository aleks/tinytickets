// Read invalidations are coalesced before starting a request. Events received
// during a read always schedule a trailing read: their write may not be in the
// in-flight snapshot. Writes themselves never pass through or retry in this queue.
export function createRefreshQueue(
  load: (signal: AbortSignal) => Promise<void>,
  onError: (error: unknown) => void,
  delay = 20,
) {
  let generation = 0
  let running = false
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let controller: AbortController | undefined
  let waiters: { generation: number; resolve: () => void }[] = []

  function settle(through: number) {
    const ready = waiters.filter((waiter) => waiter.generation <= through)
    waiters = waiters.filter((waiter) => waiter.generation > through)
    ready.forEach((waiter) => waiter.resolve())
  }

  function schedule() {
    if (!disposed && !running && timer === undefined) timer = setTimeout(() => void run(), delay)
  }

  async function run() {
    timer = undefined
    if (disposed) return
    running = true
    const started = generation
    controller = new AbortController()
    try {
      await load(controller.signal)
    } catch (error) {
      if (!disposed && !controller.signal.aborted) onError(error)
    } finally {
      running = false
      controller = undefined
      settle(started)
      if (generation > started) schedule()
    }
  }

  return {
    invalidate(): Promise<void> {
      if (disposed) return Promise.resolve()
      generation++
      const result = new Promise<void>((resolve) => waiters.push({ generation, resolve }))
      schedule()
      return result
    },
    dispose() {
      disposed = true
      clearTimeout(timer)
      controller?.abort()
      settle(Infinity)
    },
  }
}
