import type { View } from '../../app/routing'
import type { Link, Ticket, Workspace } from '../../shared/types'

export function indexWorkspace(data: Workspace) {
  return {
    projects: new Map(data.projects.map((project) => [project.id, project])),
    epics: new Map(data.epics.map((epic) => [epic.id, epic])),
    tickets: new Map(data.tickets.map((ticket) => [ticket.id, ticket])),
  }
}

export function selectVisibleEpics(data: Workspace, view: View) {
  return data.epics.filter((epic) =>
    view.type === 'epic'
      ? epic.id === view.id
      : view.type === 'epics'
        ? true
        : !epic.archived &&
          (view.type === 'home'
            ? !epic.completed
            : view.type === 'project'
              ? epic.project_id === view.id
              : true),
  )
}

export function selectVisibleTickets(data: Workspace, epicIDs: Set<number>, query: string) {
  return data.tickets.filter(
    (ticket) =>
      epicIDs.has(ticket.epic_id) &&
      (!query ||
        `${ticket.title} ${ticket.description} TT-${ticket.id}`
          .toLowerCase()
          .includes(query.toLowerCase())),
  )
}

export function selectUnfinishedBlockers(
  ticketID: number,
  links: Link[],
  tickets: ReadonlyMap<number, Pick<Ticket, 'status'>>,
) {
  // Keep dangling links conservative, matching the board's blocked badge.
  return links.filter(
    (link) => link.blocked_id === ticketID && tickets.get(link.blocker_id)?.status !== 'done',
  )
}

export function selectReadyTickets(data: Workspace) {
  const index = indexWorkspace(data)
  return data.tickets.filter((ticket) => {
    const epic = index.epics.get(ticket.epic_id)
    return (
      ticket.status === 'todo' &&
      epic !== undefined &&
      !epic.completed &&
      !epic.archived &&
      selectUnfinishedBlockers(ticket.id, data.links, index.tickets).length === 0
    )
  })
}
