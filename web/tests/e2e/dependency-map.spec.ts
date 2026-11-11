import assert from 'node:assert/strict'
import { test } from './fixtures'
import { api } from './helpers/api'

test('dependency maps preserve readiness, external chains, live updates and accessible controls', async ({
  page,
  serverURL: url,
}) => {
  const { create, patch } = api(page.request, url)
  const project = await create('projects', { name: 'Dependency map coverage' })
  const external = await create('projects', { name: 'External map context' })
  const active = await create('epics', { project_id: project.id, title: 'Active dependency work' })
  const closed = await create('epics', {
    project_id: project.id,
    title: 'Closed dependency epic',
    completed: true,
  })
  const archive = await create('epics', {
    project_id: project.id,
    title: 'Archived dependency epic',
    completed: true,
    archived: true,
  })
  const boundary = await create('epics', {
    project_id: external.id,
    title: 'External dependency work',
  })
  const task = (title: string, status = 'todo', epic_id = active.id) =>
    create('tickets', { title, status, epic_id })
  const a = await task('Design contract', 'done')
  const b = await task('Implement API')
  const c = await task('Implement UI', 'in_progress')
  const d = await task('Integration join')
  const review = await task('Review branch', 'ready_for_review')
  const independent = await task('<img src=x> ' + 'x'.repeat(160))
  const finished = await task('Closed epic todo', 'todo', closed.id)
  const hidden = await task('Unlinked archived ticket', 'todo', archive.id)
  const archivedBlocker = await task('Linked archived blocker', 'todo', archive.id)
  const x = await task('External prerequisite', 'todo', boundary.id)
  const upstream = await task('External upstream', 'todo', boundary.id)
  const y = await task('External follow-up', 'todo', boundary.id)
  const downstream = await task('External downstream', 'todo', boundary.id)
  const links = [
    [a, b],
    [a, c],
    [b, d],
    [c, d],
    [c, review],
    [archivedBlocker, d],
    [x, b],
    [upstream, x],
    [d, y],
    [y, downstream],
  ]
  for (const [blocker, blocked] of links)
    await create('links', { blocker_id: blocker.id, blocked_id: blocked.id })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`${url}/#project/${project.id}`)
  const tabs = page.getByRole('navigation', { name: 'Project views', exact: true })
  await tabs.getByRole('link', { name: 'Dependencies', exact: true }).click()
  const map = page.locator('.dependency-map')
  await map.getByRole('heading', { name: 'Dependency map', exact: true }).waitFor()
  const guide = map.getByRole('region', { name: 'How to read the dependency map', exact: true })
  await guide.getByRole('heading', { name: 'How to read the map', exact: true }).waitFor()
  for (const explanation of [
    'The blocking ticket is not Done yet, so the dependency is unresolved.',
    'The blocking ticket is Done, so the dependency is satisfied.',
    "The selected ticket's chain is highlighted. This overrides the normal line styling.",
    'Linked context from another project or a hidden archived epic.',
  ]) {
    await guide.getByText(explanation, { exact: true }).waitFor()
  }
  const graphBounds = await map.locator('.dependency-scroll').boundingBox()
  const guideBounds = await guide.boundingBox()
  assert.ok(guideBounds && graphBounds)
  assert.ok(guideBounds.y >= graphBounds.y + graphBounds.height)
  assert.equal(new URL(page.url()).hash, `#project/${project.id}/dependencies`)
  assert.equal(
    await tabs
      .getByRole('link', { name: 'Dependencies', exact: true })
      .getAttribute('aria-current'),
    'page',
  )
  assert.equal(
    await tabs.getByRole('link', { name: 'Board', exact: true }).getAttribute('aria-current'),
    null,
  )
  const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb', exact: true })
  assert.equal(
    await breadcrumb
      .getByRole('link', { name: 'Dependencies', exact: true })
      .getAttribute('aria-current'),
    'page',
  )
  const node = (t: { id: number }) => map.locator(`.map-node[data-ticket-id="${t.id}"]`)
  assert.equal(await node(hidden).count(), 0)
  assert.equal(await node(upstream).count(), 0)
  assert.equal(await node(downstream).count(), 0)
  assert.equal(await node(archivedBlocker).count(), 1)
  assert.equal(
    await node(archivedBlocker).locator('.map-node-badges').textContent(),
    'Archived epic',
  )
  assert.ok((await node(x).getAttribute('class'))?.includes('map-node-context'))
  assert.ok((await node(x).textContent())?.includes('External map context'))
  assert.equal(await node(x).getAttribute('data-state'), 'blocked')
  assert.equal(await node(b).getAttribute('data-state'), 'blocked')
  assert.equal(await node(finished).getAttribute('data-state'), 'todo')
  assert.equal(await node(finished).locator('.map-ready-badge').count(), 0)
  assert.equal(await node(independent).getAttribute('data-state'), 'ready')
  assert.equal(await node(independent).locator('img').count(), 0)
  const ready = await (
    await page.request.get(`${url}/api/tickets/ready?project_id=${project.id}`)
  ).json()
  const graphReady = await map
    .locator('.map-node[data-state="ready"]')
    .evaluateAll((nodes) => nodes.map((n) => Number(n.dataset.ticketId)))
  assert.deepEqual(
    graphReady,
    ready.tickets.map((t: { id: number }) => t.id),
  )
  const canvasNodes = await map.locator('.map-node').evaluateAll((nodes) =>
    nodes.map((n) => ({
      id: Number(n.dataset.ticketId),
      x: Number.parseFloat(n.style.left),
      y: Number.parseFloat(n.style.top),
    })),
  )
  const edges = await map
    .locator('.map-edge')
    .evaluateAll((paths) =>
      paths.map((p) => ({ from: Number(p.dataset.blocker), to: Number(p.dataset.dependent) })),
    )
  assert.equal(edges.length, 8)
  for (const edge of edges) {
    const from = canvasNodes.find((n) => n.id === edge.from)
    const to = canvasNodes.find((n) => n.id === edge.to)
    assert.ok(from && to)
    assert.ok(from.x < to.x)
  }
  assert.ok((await map.locator('.map-edge-satisfied').count()) > 0)
  await map.getByRole('button', { name: 'Fit width', exact: true }).click()
  assert.ok(
    await map.locator('.dependency-scroll').evaluate((el) => el.scrollWidth <= el.clientWidth + 2),
  )
  await map.getByRole('button', { name: 'Reset map zoom', exact: true }).click()

  // Selection works by keyboard, with semantic relationships beside the graph.
  await node(d).getByRole('button').focus()
  await page.keyboard.press('Enter')
  const selection = map.getByRole('complementary', {
    name: 'Selected dependency ticket',
    exact: true,
  })
  await selection.getByText('Integration join', { exact: true }).waitFor()
  assert.equal(await node(d).getByRole('button').getAttribute('aria-pressed'), 'true')
  assert.equal(
    await selection.locator('.dependency-relations').first().getByRole('link').count(),
    3,
  )
  assert.ok((await node(independent).getAttribute('class'))?.includes('map-node-dimmed'))
  await map.getByRole('checkbox', { name: `Show only TT-${d.id}'s chain`, exact: true }).check()
  assert.equal(await node(independent).count(), 0)
  assert.equal(await node(review).count(), 0) // sibling branch is not a descendant of the join
  await map.getByRole('checkbox', { name: 'Expand external chains', exact: true }).check()
  assert.equal(await node(upstream).count(), 1)
  assert.equal(await node(downstream).count(), 1)
  await map.getByRole('button', { name: 'Clear selection', exact: true }).click()
  assert.equal(await node(independent).count(), 1)
  await map.getByRole('checkbox', { name: 'Include archived epics', exact: true }).check()
  assert.equal(await node(hidden).count(), 1)
  assert.equal(await node(hidden).locator('.map-ready-badge').count(), 0)

  // Ticket links preserve browser history and direct map URLs survive reloads.
  await node(b)
    .getByRole('link', { name: `Open TT-${b.id}`, exact: true })
    .click()
  await page.getByRole('heading', { name: b.title, exact: true }).waitFor()
  assert.equal(new URL(page.url()).hash, `#ticket/${b.id}`)
  await page.goBack()
  await map.getByRole('heading', { name: 'Dependency map', exact: true }).waitFor()
  await page.reload()
  await map.getByRole('heading', { name: 'Dependency map', exact: true }).waitFor()
  assert.equal(
    await tabs
      .getByRole('link', { name: 'Dependencies', exact: true })
      .getAttribute('aria-current'),
    'page',
  )

  // Live updates recompute readiness from ALL blockers, even hidden done nodes.
  await patch('tickets', x.id, { status: 'done' })
  await page.waitForFunction(
    (id) =>
      document.querySelector<HTMLElement>(`.map-node[data-ticket-id="${id}"]`)?.dataset.state ===
      'ready',
    b.id,
  )
  await map.getByRole('checkbox', { name: 'Hide done tickets', exact: true }).check()
  assert.equal(await node(a).count(), 0)
  assert.equal(await node(x).count(), 0)
  assert.equal(await node(b).getAttribute('data-state'), 'ready')
  const claimed = await page.request.post(`${url}/api/tickets/${b.id}/claim`, { data: {} })
  assert.equal(claimed.status(), 200)
  await page.waitForFunction(
    (id) =>
      document.querySelector<HTMLElement>(`.map-node[data-ticket-id="${id}"]`)?.dataset.state ===
      'in_progress',
    b.id,
  )
  for (const t of [b, c, archivedBlocker]) await patch('tickets', t.id, { status: 'done' })
  await page.waitForFunction(
    (id) =>
      document.querySelector<HTMLElement>(`.map-node[data-ticket-id="${id}"]`)?.dataset.state ===
      'ready',
    d.id,
  )
  await patch('tickets', c.id, { status: 'in_progress' })
  await page.waitForFunction(
    (id) =>
      document.querySelector<HTMLElement>(`.map-node[data-ticket-id="${id}"]`)?.dataset.state ===
      'blocked',
    d.id,
  )
  const unlink = await page.request.delete(`${url}/api/links`, {
    data: { blocker_id: c.id, blocked_id: d.id },
  })
  assert.equal(unlink.status(), 200)
  await page.waitForFunction(
    (id) =>
      document.querySelector<HTMLElement>(`.map-node[data-ticket-id="${id}"]`)?.dataset.state ===
      'ready',
    d.id,
  )
  await create('links', { blocker_id: c.id, blocked_id: d.id })
  await page.waitForFunction(
    (id) =>
      document.querySelector<HTMLElement>(`.map-node[data-ticket-id="${id}"]`)?.dataset.state ===
      'blocked',
    d.id,
  )
  await patch('epics', closed.id, { completed: false })
  await page.waitForFunction(
    (id) =>
      document.querySelector<HTMLElement>(`.map-node[data-ticket-id="${id}"]`)?.dataset.state ===
      'ready',
    finished.id,
  )
  const deletion = await page.request.delete(`${url}/api/tickets/${review.id}`)
  assert.equal(deletion.status(), 200)
  await page.waitForFunction(
    (id) => !document.querySelector(`.map-node[data-ticket-id="${id}"]`),
    review.id,
  )

  // Zoom and scroll are local view controls, not data mutations; no page overflow.
  await map.getByRole('button', { name: 'Zoom out', exact: true }).click()
  await map.getByRole('button', { name: 'Zoom out', exact: true }).click()
  assert.equal(
    await map.getByRole('button', { name: 'Reset map zoom', exact: true }).textContent(),
    '50%',
  )
  await map.getByRole('button', { name: 'Zoom out', exact: true }).click()
  assert.equal(
    await map.getByRole('button', { name: 'Reset map zoom', exact: true }).textContent(),
    '25%',
  )
  assert.equal(await map.getByRole('button', { name: 'Zoom out', exact: true }).isDisabled(), true)
  await map.getByRole('button', { name: 'Reset map zoom', exact: true }).click()
  for (const theme of ['light', 'dark']) {
    if ((await page.locator('html').getAttribute('data-theme')) !== theme)
      await page.getByRole('button', { name: `Switch to ${theme} mode`, exact: true }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    await node(d).getByRole('button').click()
    await selection.waitFor()
    assert.equal(await guide.isVisible(), true)
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    )
    assert.ok(
      await map.locator('.dependency-scroll').evaluate((el) => el.scrollWidth > el.clientWidth),
    )
    await page.setViewportSize({ width: 1440, height: 1000 })
  }

  // Malformed imported cycles produce a warning rather than an infinite layout.
  await page.route('**/api/state', async (route) => {
    const response = await route.fetch()
    const data = await response.json()
    data.links.push({ blocker_id: c.id, blocked_id: a.id })
    await route.fulfill({ response, json: data })
  })
  await page.reload()
  await map.getByRole('alert').filter({ hasText: 'Some dependencies contain a cycle' }).waitFor()
  assert.ok((await map.locator('.map-node').count()) > 0)
  await page.unroute('**/api/state')

  const empty = await create('projects', { name: 'Empty dependency map' })
  await page.goto(`${url}/#project/${empty.id}/dependencies`)
  await map.getByRole('heading', { name: 'No tickets yet', exact: true }).waitFor()
  const isolatedEpic = await create('epics', { project_id: empty.id, title: 'Independent work' })
  await create('tickets', { epic_id: isolatedEpic.id, title: 'No dependency links' })
  await map.getByText('No dependency arrows in this view.', { exact: false }).waitFor()
  assert.equal(await map.locator('.map-edge').count(), 0)
  await patch('epics', isolatedEpic.id, { completed: true, archived: true })
  await map.getByRole('heading', { name: 'No tickets match these filters', exact: true }).waitFor()
  await map.getByRole('checkbox', { name: 'Include archived epics', exact: true }).check()
  await map.getByText('No dependency arrows in this view.', { exact: false }).waitFor()
})
