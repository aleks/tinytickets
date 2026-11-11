import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { TicketColumnTimer } from './TicketColumnTimer'

const start = '2026-11-11T12:00:00.000Z'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(start)
})

describe('TicketColumnTimer', () => {
  test.each([
    ['in_progress', 'In progress'],
    ['ready_for_review', 'Ready for review'],
  ] as const)('ticks elapsed time in %s without fetching', (status, label) => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    vi.stubGlobal('fetch', fetch)
    render(<TicketColumnTimer status={status} since={start} />)

    expect(screen.getByLabelText(`Time in ${label}: 0:00`)).toHaveAttribute(
      'data-status-since',
      start,
    )
    act(() => vi.advanceTimersByTime(61000))
    const timer = screen.getByLabelText(`Time in ${label}: 1:01`)
    expect(timer).toHaveAttribute('data-elapsed-seconds', '61')
    expect(timer.querySelector('time')).toHaveAttribute('datetime', 'PT61S')
    expect(fetch).not.toHaveBeenCalled()
  })

  test.each(['todo', 'done'] as const)('does not subscribe for untimed status %s', (status) => {
    const { container } = render(<TicketColumnTimer status={status} since={start} />)
    expect(container).toBeEmptyDOMElement()
    expect(vi.getTimerCount()).toBe(0)
  })

  test.each(['in_progress', 'ready_for_review'] as const)(
    'does not infer unknown %s timing',
    (status) => {
      const label = status === 'in_progress' ? 'In progress' : 'Ready for review'
      const { rerender } = render(<TicketColumnTimer status={status} since={null} />)
      expect(screen.getByLabelText(`${label} column time unavailable`)).toHaveTextContent('—')
      rerender(<TicketColumnTimer status={status} since="not-a-date" />)
      expect(screen.getByLabelText(`${label} column time unavailable`)).toHaveTextContent('—')
      expect(vi.getTimerCount()).toBe(0)
    },
  )

  test('formats hours and days and clamps future entry times to zero', () => {
    const { rerender } = render(
      <TicketColumnTimer status="in_progress" since="2026-11-11T10:58:59.000Z" />,
    )
    expect(screen.getByLabelText('Time in In progress: 1:01:01')).toBeInTheDocument()
    rerender(<TicketColumnTimer status="in_progress" since="2026-11-10T10:58:59.000Z" />)
    expect(screen.getByLabelText('Time in In progress: 1d 01:01:01')).toBeInTheDocument()
    rerender(<TicketColumnTimer status="in_progress" since="2026-11-12T12:00:00.000Z" />)
    expect(screen.getByLabelText('Time in In progress: 0:00')).toBeInTheDocument()
  })

  test('uses the current clock on mount and catches up after suspended ticks', () => {
    vi.setSystemTime('2026-11-11T12:02:00.000Z')
    render(<TicketColumnTimer status="in_progress" since={start} />)
    expect(screen.getByLabelText('Time in In progress: 2:00')).toBeInTheDocument()

    vi.setSystemTime('2026-11-11T12:05:00.000Z')
    fireEvent.focus(window)
    expect(screen.getByLabelText('Time in In progress: 5:00')).toBeInTheDocument()

    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    vi.setSystemTime('2026-11-11T12:10:00.000Z')
    fireEvent(document, new Event('visibilitychange'))
    expect(screen.getByLabelText('Time in In progress: 5:00')).toBeInTheDocument()
    hidden.mockReturnValue(false)
    fireEvent(document, new Event('visibilitychange'))
    expect(screen.getByLabelText('Time in In progress: 10:00')).toBeInTheDocument()
  })

  test('shares one subscription and removes its interval and wake listeners on final unmount', () => {
    const addWindow = vi.spyOn(window, 'addEventListener')
    const removeWindow = vi.spyOn(window, 'removeEventListener')
    const addDocument = vi.spyOn(document, 'addEventListener')
    const removeDocument = vi.spyOn(document, 'removeEventListener')
    const first = render(<TicketColumnTimer status="in_progress" since={start} />)
    const second = render(<TicketColumnTimer status="ready_for_review" since={start} />)
    expect(vi.getTimerCount()).toBe(1)
    const focusListeners = addWindow.mock.calls.filter(([name]) => name === 'focus')
    const visibilityListeners = addDocument.mock.calls.filter(
      ([name]) => name === 'visibilitychange',
    )
    expect(focusListeners).toHaveLength(1)
    expect(visibilityListeners).toHaveLength(1)

    first.unmount()
    expect(vi.getTimerCount()).toBe(1)
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.getByLabelText('Time in Ready for review: 0:01')).toBeInTheDocument()

    second.unmount()
    expect(vi.getTimerCount()).toBe(0)
    expect(removeWindow).toHaveBeenCalledWith('focus', focusListeners[0][1])
    expect(removeDocument).toHaveBeenCalledWith('visibilitychange', visibilityListeners[0][1])

    vi.setSystemTime('2026-11-11T12:03:00.000Z')
    const remounted = render(<TicketColumnTimer status="in_progress" since={start} />)
    expect(screen.getByLabelText('Time in In progress: 3:00')).toBeInTheDocument()
    expect(vi.getTimerCount()).toBe(1)
    remounted.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
