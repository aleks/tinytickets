import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { api, ApiError, type Mutate } from '../../shared/api'
import type { DeletionPreview } from '../../shared/types'
import { DeletionDialog } from './DeletionDialog'

const preview: DeletionPreview = {
  kind: 'projects',
  id: 1,
  name: 'Project',
  requires_force: true,
  confirmation_token: 'first',
  counts: {
    epics: 2,
    tickets: 3,
    archived_epics: 1,
    work_log_entries: 4,
    status_events: 5,
    dependency_links: 2,
    external_dependency_links: 1,
  },
}
const mutate: Mutate = <T,>(operation: Promise<T>) => operation
function setup(result = preview) {
  const read = vi.spyOn(api, 'deletionPreview').mockResolvedValue(result)
  const remove = vi.spyOn(api, 'deleteResource').mockResolvedValue({ id: 1 })
  const close = vi.fn()
  const deleted = vi.fn()
  const view = render(
    <DeletionDialog
      kind={result.kind}
      id={1}
      name="Fallback"
      mutate={mutate}
      close={close}
      deleted={deleted}
    />,
  )
  return { read, remove, close, deleted, ...view }
}

test('defaults to Cancel and requires explicit force; shows counts and cross-hierarchy warning', async () => {
  const { remove, deleted } = setup()
  expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
  expect(screen.getByRole('button', { name: 'Delete project' })).toBeDisabled()
  const force = await screen.findByRole('checkbox', { name: /^Force delete/ })
  expect(force).not.toBeChecked()
  expect(screen.getByText('2 epics (1 archived)')).toBeInTheDocument()
  expect(screen.getByText(/Linked tickets outside/)).toBeInTheDocument()
  expect(screen.queryByText(/This cannot be undone/)).not.toBeInTheDocument()
  fireEvent.click(force)
  expect(screen.getByText(/This cannot be undone/)).toHaveTextContent(
    'metrics are removed, not archived',
  )
  fireEvent.click(screen.getByRole('button', { name: 'Delete project' }))
  await waitFor(() => expect(deleted).toHaveBeenCalledOnce())
  expect(remove).toHaveBeenCalledExactlyOnceWith(
    'projects',
    1,
    { force: true, confirmation_token: 'first' },
    expect.any(AbortSignal),
  )
})

test.each(['projects', 'epics', 'tickets'] as const)(
  'empty %s do not offer force and always submit a token',
  async (kind) => {
    const { remove } = setup({ ...preview, kind, requires_force: false })
    const noun = kind === 'projects' ? 'project' : kind === 'epics' ? 'epic' : 'ticket'
    await waitFor(() =>
      expect(screen.getByRole('button', { name: `Delete ${noun}` })).toBeEnabled(),
    )
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: `Delete ${noun}` }))
    expect(remove).toHaveBeenCalledWith(
      kind,
      1,
      { confirmation_token: 'first' },
      expect.any(AbortSignal),
    )
  },
)

test('Escape cancels and Tab wraps safely without deleting', async () => {
  const { close, remove } = setup({ ...preview, requires_force: false })
  const submit = screen.getByRole('button', { name: 'Delete project' })
  await waitFor(() => expect(submit).toBeEnabled())
  submit.focus()
  fireEvent.keyDown(document, { key: 'Tab' })
  expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
  expect(submit).toHaveFocus()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(close).toHaveBeenCalledOnce()
  expect(remove).not.toHaveBeenCalled()
})

test('409 refreshes scope, clears force and requires a new explicit confirmation', async () => {
  const { read, remove } = setup()
  remove.mockRejectedValueOnce(new ApiError('Changed', 409))
  read.mockResolvedValue({
    ...preview,
    confirmation_token: 'second',
    counts: { ...preview.counts, tickets: 9 },
  })
  fireEvent.click(await screen.findByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Delete project' }))
  await screen.findByText('9 tickets')
  expect(screen.getByRole('alert')).toHaveTextContent('scope changed')
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  expect(screen.getByRole('button', { name: 'Delete project' })).toBeDisabled()
  expect(remove).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Delete project' }))
  await waitFor(() => expect(remove).toHaveBeenCalledTimes(2))
  expect(remove).toHaveBeenLastCalledWith(
    'projects',
    1,
    { force: true, confirmation_token: 'second' },
    expect.any(AbortSignal),
  )
})

test('delete network failure is visible and never retried automatically', async () => {
  const { remove } = setup()
  remove.mockRejectedValue(new TypeError('Offline'))
  fireEvent.click(await screen.findByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Delete project' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Deletion was not retried')
  expect(remove).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: 'Delete project' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Retry preview' })).toBeEnabled()
})

test('failed previews can be retried and a missing target is clearly reported', async () => {
  vi.spyOn(api, 'deletionPreview')
    .mockRejectedValueOnce(new Error('Offline'))
    .mockRejectedValueOnce(new ApiError('Missing', 404))
  const close = vi.fn()
  render(
    <DeletionDialog
      kind="epics"
      id={1}
      name="Epic"
      mutate={mutate}
      close={close}
      deleted={vi.fn()}
    />,
  )
  expect(await screen.findByRole('alert')).toHaveTextContent('Offline')
  fireEvent.click(screen.getByRole('button', { name: 'Retry preview' }))
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('This epic has already been deleted.'),
  )
  expect(screen.queryByRole('button', { name: 'Retry preview' })).not.toBeInTheDocument()
})

test('busy deletion blocks duplicate submission and dismissal and aborts on unmount', async () => {
  const { remove, close, unmount } = setup({ ...preview, requires_force: false })
  let finish!: (value: { id: number }) => void
  remove.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const submit = screen.getByRole('button', { name: 'Delete project' })
  await waitFor(() => expect(submit).toBeEnabled())
  fireEvent.click(submit)
  fireEvent.click(submit)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  fireEvent.keyDown(document, { key: 'Tab' })
  expect(screen.getByRole('dialog', { name: 'Delete project' })).toHaveFocus()
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
  expect(screen.getByRole('dialog', { name: 'Delete project' })).toHaveFocus()
  expect(close).not.toHaveBeenCalled()
  expect(remove).toHaveBeenCalledTimes(1)
  const signal = remove.mock.calls[0][3]
  unmount()
  expect(signal?.aborted).toBe(true)
  await act(async () => finish({ id: 1 }))
})

test('cancelling an outstanding preview aborts its read', () => {
  const { unmount, read } = setup()
  const signal = read.mock.calls[0][2]
  unmount()
  expect(signal?.aborted).toBe(true)
})
