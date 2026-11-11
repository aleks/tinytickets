import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { Editor } from './Editor'
import { api, type Mutate } from '../../shared/api'
import type { Ticket, Workspace } from '../../shared/types'

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
