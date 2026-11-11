import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { Editor } from './Editor'
import { api, type Mutate } from '../../shared/api'
import type { Ticket, Workspace } from '../../shared/types'

test('cancelling ticket deletion preserves the draft with exactly one active dialog', async () => {
  const ticket: Ticket = {
    id: 1,
    epic_id: 1,
    title: 'Original',
    description: 'Description',
    status: 'todo',
    created_at: '',
    updated_at: '',
    status_since: null,
  }
  const data: Workspace = {
    projects: [{ id: 1, name: 'Project' }],
    epics: [{ id: 1, project_id: 1, title: 'Epic', completed: false, archived: false }],
    tickets: [ticket],
    links: [],
  }
  vi.spyOn(api, 'deletionPreview').mockResolvedValue({
    kind: 'tickets',
    id: 1,
    name: 'Original',
    requires_force: false,
    confirmation_token: 'token',
    counts: {
      epics: 0,
      tickets: 0,
      archived_epics: 0,
      work_log_entries: 1,
      status_events: 2,
      dependency_links: 0,
      external_dependency_links: 0,
    },
  })
  const remove = vi.spyOn(api, 'deleteResource')
  const confirm = vi.spyOn(window, 'confirm')
  render(
    <Editor
      dialog={{ type: 'ticket', item: ticket }}
      data={data}
      mutate={<T,>(operation: Promise<T>) => operation}
      close={vi.fn()}
      openTicket={vi.fn()}
      openPage={vi.fn()}
    />,
  )
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'My draft' } })
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'My description' } })
  fireEvent.click(screen.getByRole('button', { name: 'Delete ticket' }))
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  expect(screen.getByRole('dialog', { name: 'Delete ticket' })).toBeInTheDocument()
  await screen.findByText(/unsaved editor draft/)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  expect(screen.getByLabelText('Title')).toHaveValue('My draft')
  expect(screen.getByLabelText('Description')).toHaveValue('My description')
  expect(screen.getByLabelText('Title')).toHaveFocus()
  expect(remove).not.toHaveBeenCalled()
  expect(confirm).not.toHaveBeenCalled()
})

test('keeps the draft through refreshes and submits only dirty ticket fields', async () => {
  const ticket: Ticket = {
    id: 1,
    epic_id: 1,
    title: 'Original',
    description: 'Original description',
    status: 'todo',
    created_at: '',
    updated_at: '',
    status_since: null,
  }
  const data: Workspace = {
    projects: [{ id: 1, name: 'Project' }],
    epics: [{ id: 1, project_id: 1, title: 'Epic', completed: false, archived: false }],
    tickets: [ticket],
    links: [],
  }
  const updated = { ...ticket, status: 'in_progress' as const, description: 'Agent changed this' }
  const update = vi.spyOn(api, 'updateTicket').mockResolvedValue(updated)
  const close = vi.fn()
  const mutate: Mutate = <T,>(operation: Promise<T>) => operation
  const editor = (snapshot: Workspace) => (
    <Editor
      dialog={{ type: 'ticket', item: ticket }}
      data={snapshot}
      mutate={mutate}
      close={close}
      openTicket={vi.fn()}
      openPage={vi.fn()}
    />
  )
  const { rerender } = render(editor(data))
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'My draft' } })
  rerender(editor({ ...data, tickets: [updated] }))
  expect(screen.getByLabelText('Title')).toHaveValue('My draft')
  expect(screen.getByLabelText('Description')).toHaveValue('Original description')
  expect(screen.getByLabelText('Status')).toHaveValue('todo')
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  await waitFor(() => expect(close).toHaveBeenCalledOnce())
  expect(update).toHaveBeenCalledWith(1, { title: 'My draft' })
})
