import { describe, expect, it } from 'vitest'
import type { Ticket, Workspace } from '../../shared/types'
import {
  indexWorkspace,
  selectReadyTickets,
  selectUnfinishedBlockers,
  selectVisibleEpics,
  selectVisibleTickets,
} from './selectors'

function ticket(id: number, epic_id: number, status: Ticket['status'] = 'todo'): Ticket {
  return {
    id,
    epic_id,
    status,
    title: `Task ${id}`,
    description: 'Description',
    created_at: '',
    updated_at: '',
    status_since: null,
  }
}

function workspace(): Workspace {
  return {
    projects: [
      { id: 1, name: 'One' },
      { id: 2, name: 'Two' },
    ],
    epics: [
      { id: 1, project_id: 1, title: 'Active', completed: false, archived: false },
      { id: 2, project_id: 1, title: 'Completed', completed: true, archived: false },
      { id: 3, project_id: 1, title: 'Archived', completed: true, archived: true },
      { id: 4, project_id: 2, title: 'External', completed: false, archived: false },
    ],
    tickets: [
      ticket(1, 1),
      ticket(2, 2),
      ticket(3, 3),
      ticket(4, 4),
      ticket(5, 1, 'done'),
      ticket(6, 1, 'in_progress'),
      ticket(7, 1, 'ready_for_review'),
    ],
    links: [],
  }
}

describe('workspace selectors', () => {
  it('indexes the original snapshot objects by ID', () => {
    const data = workspace()
    const index = indexWorkspace(data)
    expect(index.projects.get(1)).toBe(data.projects[0])
    expect(index.epics.get(3)).toBe(data.epics[2])
    expect(index.tickets.get(7)).toBe(data.tickets[6])
    expect(index.tickets.get(99)).toBeUndefined()
  })

  it('preserves archive visibility and direct archived epic navigation', () => {
    const data = workspace()
    expect(selectVisibleEpics(data, { type: 'home' }).map((e) => e.id)).toEqual([1, 4])
    expect(selectVisibleEpics(data, { type: 'project', id: 1 }).map((e) => e.id)).toEqual([1, 2])
    expect(selectVisibleEpics(data, { type: 'epic', id: 3 }).map((e) => e.id)).toEqual([3])
    expect(selectVisibleEpics(data, { type: 'epics' }).map((e) => e.id)).toEqual([1, 2, 3, 4])
  })

  it('filters tickets by visible epic and case-insensitive title, description, or ID', () => {
    const data = workspace()
    expect(selectVisibleTickets(data, new Set([3]), '').map((t) => t.id)).toEqual([3])
    expect(selectVisibleTickets(data, new Set([1]), 'tt-1').map((t) => t.id)).toEqual([1])
    expect(selectVisibleTickets(data, new Set([1]), 'TASK 5').map((t) => t.id)).toEqual([5])
    expect(selectVisibleTickets(data, new Set([4]), 'description').map((t) => t.id)).toEqual([4])
  })

  it('requires Todo in an open unarchived epic and respects cross-project blockers', () => {
    const data = workspace()
    data.links = [{ blocker_id: 4, blocked_id: 1 }]
    expect(selectReadyTickets(data).map((t) => t.id)).toEqual([4])
    data.tickets[3].status = 'done'
    expect(selectReadyTickets(data).map((t) => t.id)).toEqual([1])
    data.tickets.push(ticket(8, 99))
    expect(selectReadyTickets(data).map((t) => t.id)).toEqual([1])
  })

  it('counts unfinished and missing blockers, not done blockers or outgoing links', () => {
    const data = workspace()
    data.links = [
      { blocker_id: 5, blocked_id: 1 },
      { blocker_id: 6, blocked_id: 1 },
      { blocker_id: 99, blocked_id: 1 },
      { blocker_id: 1, blocked_id: 4 },
    ]
    expect(selectUnfinishedBlockers(1, data.links, indexWorkspace(data).tickets)).toEqual(
      data.links.slice(1, 3),
    )
    expect(selectReadyTickets(data)).toEqual([])
  })
})
