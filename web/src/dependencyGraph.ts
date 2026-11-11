export type MapTicket = { id: number; epic_id: number; title: string; status: string }
export type MapEpic = {
  id: number
  project_id: number
  title: string
  completed: boolean
  archived: boolean
}
export type MapLink = { blocker_id: number; blocked_id: number }
export type MapWorkspace = {
  projects: { id: number; name: string }[]
  epics: MapEpic[]
  tickets: MapTicket[]
  links: MapLink[]
}
export type MapOptions = {
  includeArchived?: boolean
  expandExternal?: boolean
  hideDone?: boolean
  focusID?: number
}
export type MapNode = {
  ticket: MapTicket
  epic: MapEpic
  projectName: string
  external: boolean
  context: boolean
  ready: boolean
  blocked: boolean
  unfinishedBlockers: number
  outsideLinks: number
  x: number
  y: number
}
export const nodeWidth = 244
export const nodeHeight = 148
const columnGap = 88
const rowGap = 24
const padding = 24

// Iterative traversal avoids stack limits on long chains. Following each direction
// separately selects ancestors + descendants, not unrelated sibling branches.
export function dependencyChain(id: number, links: MapLink[]): Set<number> {
  const result = new Set([id])
  for (const direction of ['up', 'down']) {
    const adjacency = new Map<number, number[]>()
    for (const link of links) {
      const [from, to] =
        direction === 'up' ? [link.blocked_id, link.blocker_id] : [link.blocker_id, link.blocked_id]
      adjacency.set(from, [...(adjacency.get(from) || []), to])
    }
    const seen = new Set([id]),
      queue = [id]
    for (let i = 0; i < queue.length; i++)
      for (const next of adjacency.get(queue[i]) || []) {
        if (!seen.has(next)) {
          seen.add(next)
          result.add(next)
          queue.push(next)
        }
      }
  }
  return result
}

export function buildDependencyMap(
  data: MapWorkspace,
  projectID: number,
  options: MapOptions = {},
) {
  const tickets = new Map(data.tickets.map((t) => [t.id, t]))
  const epics = new Map(data.epics.map((e) => [e.id, e]))
  const projects = new Map(data.projects.map((p) => [p.id, p.name]))
  const incoming = new Map<number, number[]>(),
    outgoing = new Map<number, number[]>()
  const allLinks = data.links
    .filter((l) => tickets.has(l.blocker_id) && tickets.has(l.blocked_id))
    .slice()
    .sort((a, b) => a.blocker_id - b.blocker_id || a.blocked_id - b.blocked_id)
  for (const l of allLinks) {
    incoming.set(l.blocked_id, [...(incoming.get(l.blocked_id) || []), l.blocker_id])
    outgoing.set(l.blocker_id, [...(outgoing.get(l.blocker_id) || []), l.blocked_id])
  }
  const local = data.tickets.filter((t) => epics.get(t.epic_id)?.project_id === projectID)
  const seeds = new Set(
    local
      .filter((t) => options.includeArchived || !epics.get(t.epic_id)?.archived)
      .map((t) => t.id),
  )
  const included = new Set(seeds)
  if (options.expandExternal) {
    const queue = [...seeds]
    for (let i = 0; i < queue.length; i++)
      for (const next of [...(incoming.get(queue[i]) || []), ...(outgoing.get(queue[i]) || [])]) {
        if (!included.has(next)) {
          included.add(next)
          queue.push(next)
        }
      }
  } else {
    // One-hop boundary context is always shown, even across project/archive
    // boundaries. Never infer that an undisplayed blocker has been completed.
    for (const link of allLinks)
      if (seeds.has(link.blocker_id) || seeds.has(link.blocked_id)) {
        included.add(link.blocker_id)
        included.add(link.blocked_id)
      }
  }
  const chain = options.focusID === undefined ? null : dependencyChain(options.focusID, allLinks)
  const visible = data.tickets
    .filter(
      (t) =>
        included.has(t.id) &&
        (!options.hideDone || t.status !== 'done') &&
        (!chain || chain.has(t.id)),
    )
    .sort((a, b) => a.id - b.id)
  const ids = new Set(visible.map((t) => t.id))
  const links = allLinks.filter((l) => ids.has(l.blocker_id) && ids.has(l.blocked_id))
  const degree = new Map(visible.map((t) => [t.id, 0]))
  const rank = new Map(visible.map((t) => [t.id, 0]))
  const children = new Map<number, number[]>()
  for (const link of links) {
    degree.set(link.blocked_id, degree.get(link.blocked_id)! + 1)
    children.set(link.blocker_id, [...(children.get(link.blocker_id) || []), link.blocked_id])
  }
  const incomingCounts = new Map(degree)
  const queue = visible.filter((t) => degree.get(t.id) === 0).map((t) => t.id)
  for (let i = 0; i < queue.length; i++)
    for (const child of children.get(queue[i]) || []) {
      rank.set(child, Math.max(rank.get(child)!, rank.get(queue[i])! + 1))
      degree.set(child, degree.get(child)! - 1)
      if (degree.get(child) === 0) queue.push(child)
    }
  const cyclic = queue.length !== visible.length
  if (cyclic) {
    // Imported/directly modified databases can contain cycles despite API checks.
    // Keep every ticket accessible and warn instead of looping or hiding it.
    const last = [...rank.values()].reduce((max, value) => Math.max(max, value), 0) + 1
    for (const t of visible) if (degree.get(t.id)! > 0) rank.set(t.id, last)
  }
  const layers: MapTicket[][] = []
  for (const t of visible) (layers[rank.get(t.id)!] ||= []).push(t)
  // Long edges must not pass behind intervening ticket cards (which can make
  // them look connected to the wrong ticket). Reserve separate overhead rails.
  const longLinks = links.filter((l) => rank.get(l.blocked_id)! > rank.get(l.blocker_id)! + 1)
  const rails = new Map(
    longLinks.map((l, i) => [`${l.blocker_id}-${l.blocked_id}`, padding + i * 14]),
  )
  const overhead = longLinks.length ? longLinks.length * 14 + 16 : 0
  const sourceIndices = new Map<number, number>(),
    targetIndices = new Map<number, number>()
  const routedLinks = links.map((l) => {
    const sourceIndex = sourceIndices.get(l.blocker_id) || 0,
      targetIndex = targetIndices.get(l.blocked_id) || 0
    sourceIndices.set(l.blocker_id, sourceIndex + 1)
    targetIndices.set(l.blocked_id, targetIndex + 1)
    return {
      ...l,
      railY: rails.get(`${l.blocker_id}-${l.blocked_id}`),
      sourceIndex,
      targetIndex,
      sourcePort: (sourceIndex + 1) / (children.get(l.blocker_id)!.length + 1),
      targetPort: (targetIndex + 1) / (incomingCounts.get(l.blocked_id)! + 1),
    }
  })
  let rows = 1
  for (const layer of layers) rows = Math.max(rows, layer?.length || 0)
  const height = overhead + padding * 2 + rows * (nodeHeight + rowGap) - rowGap
  const nodes: MapNode[] = []
  for (let column = 0; column < layers.length; column++) {
    const layer = layers[column] || []
    for (let row = 0; row < layer.length; row++) {
      const ticket = layer[row],
        epic = epics.get(ticket.epic_id)
      if (!epic) continue
      const blockers = incoming.get(ticket.id) || []
      const unfinishedBlockers = blockers.filter((id) => tickets.get(id)?.status !== 'done').length
      nodes.push({
        ticket,
        epic,
        projectName: projects.get(epic.project_id) || 'Unknown project',
        external: epic.project_id !== projectID,
        context: !seeds.has(ticket.id),
        ready:
          ticket.status === 'todo' && !epic.completed && !epic.archived && unfinishedBlockers === 0,
        blocked: ticket.status !== 'done' && unfinishedBlockers > 0,
        unfinishedBlockers,
        outsideLinks: [...blockers, ...(outgoing.get(ticket.id) || [])].filter((id) => !ids.has(id))
          .length,
        x: padding + column * (nodeWidth + columnGap),
        y: overhead + padding + ((rows - layer.length) / 2 + row) * (nodeHeight + rowGap),
      })
    }
  }
  return {
    nodes,
    links: routedLinks,
    cyclic,
    width: Math.max(320, padding * 2 + layers.length * (nodeWidth + columnGap) - columnGap),
    height,
    totalLocal: local.length,
    archivedLocal: local.filter((t) => epics.get(t.epic_id)?.archived).length,
    contextCount: nodes.filter((n) => n.context).length,
  }
}
