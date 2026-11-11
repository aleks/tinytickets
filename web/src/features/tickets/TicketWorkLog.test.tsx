import { act, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { TicketWorkLog } from './TicketWorkLog'
import type { Mutate } from '../../shared/api'

function pendingFetch() {
  const requests: {
    signal: AbortSignal | null | undefined
    resolve: (response: Response) => void
    reject: (error: Error) => void
  }[] = []
  const fetch = vi.fn<typeof globalThis.fetch>((_input, init) => {
    return new Promise<Response>((resolve, reject) => {
      requests.push({ signal: init?.signal, resolve, reject })
    })
  })
  vi.stubGlobal('fetch', fetch)
  return { fetch, requests }
}

test('aborts replaced work-log requests and ignores stale results even if fetch still resolves', async () => {
  const { fetch, requests } = pendingFetch()
  const mutation = vi.fn<(operation: Promise<unknown>) => void>()
  const mutate: Mutate = <T,>(operation: Promise<T>) => {
    mutation(operation)
    return operation
  }
  const { rerender, unmount } = render(<TicketWorkLog ticketID={1} revision={0} mutate={mutate} />)
  expect(fetch).toHaveBeenCalledWith(
    '/api/tickets/1/work-log',
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  )
  expect(requests[0].signal?.aborted).toBe(false)

  rerender(<TicketWorkLog ticketID={2} revision={0} mutate={mutate} />)
  expect(requests[0].signal?.aborted).toBe(true)
  expect(requests[1].signal?.aborted).toBe(false)
  await act(async () => {
    requests[1].resolve(new Response(JSON.stringify({ entries: [] })))
  })
  expect(screen.getByText('No work log entries yet.')).toBeInTheDocument()

  await act(async () => {
    requests[0].resolve(
      new Response(JSON.stringify({ error: 'Stale request failed' }), { status: 500 }),
    )
  })
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByText('No work log entries yet.')).toBeInTheDocument()

  rerender(<TicketWorkLog ticketID={2} revision={1} mutate={mutate} />)
  expect(requests[1].signal?.aborted).toBe(true)
  expect(requests[2].signal?.aborted).toBe(false)
  unmount()
  expect(requests[2].signal?.aborted).toBe(true)
  await act(async () => {
    requests[2].reject(new DOMException('The operation was aborted.', 'AbortError'))
  })
  expect(mutation).not.toHaveBeenCalled()
})
