import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

// Exercise the pure TypeScript model without adding a test framework or requiring
// Node's newer type-stripping feature. The normal build still typechecks it.
const source = await readFile(new URL('./src/dependencyGraph.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { buildDependencyMap, dependencyChain, nodeHeight, nodeWidth } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const epic = (id = 1, project_id = 1, extra = {}) => ({ id, project_id, title: `Epic ${id}`, completed: false, archived: false, ...extra })
const ticket = (id, status = 'todo', epic_id = 1) => ({ id, epic_id, title: `Ticket ${id}`, status })
const link = (blocker_id, blocked_id) => ({ blocker_id, blocked_id })
const workspace = (tickets, links = [], epics = [epic()]) => ({ projects: [{ id: 1, name: 'Local' }, { id: 2, name: 'External' }], epics, tickets, links })
const ids = graph => graph.nodes.map(n => n.ticket.id).sort((a, b) => a - b)

test('fork/join layers point left-to-right, preserve independent work and do not overlap', () => {
  const data = workspace([ticket(1), ticket(2), ticket(3), ticket(4), ticket(5)], [link(1, 2), link(1, 3), link(2, 4), link(3, 4)])
  const before = JSON.stringify(data)
  const graph = buildDependencyMap(data, 1)
  assert.equal(graph.cyclic, false)
  assert.deepEqual(ids(graph), [1, 2, 3, 4, 5])
  const nodes = new Map(graph.nodes.map(n => [n.ticket.id, n]))
  for (const l of graph.links) assert.ok(nodes.get(l.blocker_id).x + nodeWidth < nodes.get(l.blocked_id).x)
  for (const a of graph.nodes) for (const b of graph.nodes) if (a.ticket.id !== b.ticket.id) {
    assert.ok(a.x + nodeWidth <= b.x || b.x + nodeWidth <= a.x || a.y + nodeHeight <= b.y || b.y + nodeHeight <= a.y)
  }
  assert.deepEqual(graph.nodes.filter(n => n.ready).map(n => n.ticket.id), [1, 5])
  assert.equal(nodes.get(4).unfinishedBlockers, 2)
  assert.equal(JSON.stringify(data), before)
  assert.deepEqual(buildDependencyMap({ ...data, tickets: [...data.tickets].reverse(), links: [...data.links].reverse() }, 1), graph)
})

test('readiness uses global blocker statuses and unfinished/unarchived parent epics', () => {
  const data = workspace([ticket(1, 'done'), ticket(2), ticket(3, 'in_progress'), ticket(4, 'ready_for_review'), ticket(5, 'todo', 2), ticket(6, 'todo', 3)], [link(1, 2), link(3, 4)], [epic(), epic(2, 1, { completed: true }), epic(3, 1, { completed: true, archived: true })])
  const graph = buildDependencyMap(data, 1, { includeArchived: true, hideDone: true })
  assert.ok(!ids(graph).includes(1))
  assert.deepEqual(graph.nodes.filter(n => n.ready).map(n => n.ticket.id), [2])
  assert.equal(graph.nodes.find(n => n.ticket.id === 4).blocked, true)
  assert.equal(graph.nodes.find(n => n.ticket.id === 2).outsideLinks, 1)
  assert.deepEqual(buildDependencyMap(workspace([ticket(1), ticket(2)], [link(1, 2)]), 1).nodes.filter(n => n.ready).map(n => n.ticket.id), [1])
})

test('long dependency arrows use overhead rails rather than crossing ticket cards', () => {
  const graph = buildDependencyMap(workspace([ticket(1), ticket(2), ticket(3), ticket(4)], [link(1, 2), link(2, 3), link(3, 4), link(1, 3), link(1, 4)]), 1)
  const routed = graph.links.filter(l => l.railY !== undefined)
  assert.equal(routed.length, 2)
  assert.equal(new Set(routed.map(l => l.railY)).size, 2)
  for (const l of routed) for (const node of graph.nodes) assert.ok(l.railY < node.y)
  for (const node of graph.nodes) assert.ok(node.y + nodeHeight <= graph.height)
  const join = graph.links.filter(l => l.blocked_id === 4)
  assert.equal(new Set(join.map(l => l.targetPort)).size, join.length)
  const fork = graph.links.filter(l => l.blocker_id === 1)
  assert.equal(new Set(fork.map(l => l.sourcePort)).size, fork.length)
  for (const l of graph.links) assert.ok(l.sourcePort > 0 && l.sourcePort < 1 && l.targetPort > 0 && l.targetPort < 1)
})

test('one-hop external/archive boundary context expands without falsely satisfying blockers', () => {
  const data = workspace([ticket(1), ticket(2, 'todo', 2), ticket(3, 'todo', 2), ticket(4, 'todo', 2), ticket(5, 'todo', 2), ticket(6, 'todo', 3), ticket(7, 'todo', 3)], [link(2, 1), link(3, 2), link(1, 4), link(4, 5), link(7, 1)], [epic(), epic(2, 2, { completed: true, archived: true }), epic(3, 1, { completed: true, archived: true })])
  const graph = buildDependencyMap(data, 1)
  assert.deepEqual(ids(graph), [1, 2, 4, 7])
  assert.equal(graph.contextCount, 3)
  assert.equal(graph.archivedLocal, 2)
  assert.equal(graph.nodes.find(n => n.ticket.id === 1).unfinishedBlockers, 2)
  assert.equal(graph.nodes.find(n => n.ticket.id === 2).outsideLinks, 1)
  assert.equal(graph.nodes.find(n => n.ticket.id === 4).outsideLinks, 1)
  assert.equal(graph.nodes.find(n => n.ticket.id === 2).external, true)
  assert.equal(graph.nodes.find(n => n.ticket.id === 7).context, true)
  assert.deepEqual(ids(buildDependencyMap(data, 1, { expandExternal: true })), [1, 2, 3, 4, 5, 7])
  const all = buildDependencyMap(data, 1, { includeArchived: true, expandExternal: true })
  assert.deepEqual(ids(all), [1, 2, 3, 4, 5, 6, 7])
  assert.equal(all.nodes.find(n => n.ticket.id === 7).context, false)
  assert.equal(all.nodes.find(n => n.ticket.id === 6).ready, false)
})

test('chain focus follows ancestors/descendants, not siblings or unrelated tickets', () => {
  const links = [link(1, 2), link(1, 3), link(2, 4), link(3, 4), link(2, 5)]
  assert.deepEqual([...dependencyChain(2, links)].sort(), [1, 2, 4, 5])
  const data = workspace(Array.from({ length: 6 }, (_, i) => ticket(i + 1)), links)
  assert.deepEqual(ids(buildDependencyMap(data, 1, { focusID: 2 })), [1, 2, 4, 5])
})

test('empty, all-archived, and malformed cyclic graphs remain finite and accessible', () => {
  const empty = buildDependencyMap(workspace([]), 1)
  assert.equal(empty.nodes.length, 0)
  assert.ok(Number.isFinite(empty.width) && Number.isFinite(empty.height))
  const archived = workspace([ticket(1)], [], [epic(1, 1, { completed: true, archived: true })])
  assert.equal(buildDependencyMap(archived, 1).nodes.length, 0)
  assert.equal(buildDependencyMap(archived, 1, { includeArchived: true }).nodes.length, 1)
  const cycle = buildDependencyMap(workspace([ticket(1), ticket(2), ticket(3)], [link(1, 2), link(2, 1), link(2, 3)]), 1)
  assert.equal(cycle.cyclic, true)
  assert.deepEqual(ids(cycle), [1, 2, 3])
  for (const node of cycle.nodes) assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y))
  assert.ok(Number.isFinite(cycle.height))
  assert.deepEqual([...dependencyChain(1, cycle.links)].sort(), [1, 2, 3])
})

test('long chains use iterative traversal and layout', () => {
  const count = 4000
  const data = workspace(Array.from({ length: count }, (_, i) => ticket(i + 1)), Array.from({ length: count - 1 }, (_, i) => link(i + 1, i + 2)))
  const graph = buildDependencyMap(data, 1)
  assert.equal(graph.nodes.length, count)
  assert.equal(graph.cyclic, false)
  assert.equal(dependencyChain(count / 2, data.links).size, count)
  assert.ok(graph.nodes.at(-1).x > graph.nodes[0].x)
})
