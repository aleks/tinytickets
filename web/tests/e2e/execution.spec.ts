import assert from 'node:assert/strict'
import { test } from './fixtures'
import { api } from './helpers/api'

test('execution insights, history, live metrics, timelines and responsive surfaces', async ({
  page,
  serverURL: url,
}) => {
  const { create, patch: update } = api(page.request, url)
  const project = await create('projects', { name: 'Execution project' })
  const epic = await create('epics', { project_id: project.id, title: 'Delivery' })
  const archived = await create('epics', {
    project_id: project.id,
    title: 'Archived work',
    completed: true,
  })
  await create('epics', { project_id: project.id, title: 'Empty epic' })
  const active = await create('tickets', { epic_id: epic.id, title: 'Reopened implementation' })
  for (const status of ['in_progress', 'ready_for_review', 'in_progress', 'done', 'in_progress'])
    await update('tickets', active.id, { status })
  const complete = await create('tickets', {
    epic_id: epic.id,
    title: 'Reviewed implementation',
    status: 'in_progress',
  })
  for (const status of ['ready_for_review', 'done'])
    await update('tickets', complete.id, { status })
  const todo = await create('tickets', { epic_id: epic.id, title: 'Not started yet' })
  const archivedTicket = await create('tickets', {
    epic_id: archived.id,
    title: 'Archived delivery',
    status: 'in_progress',
  })
  await update('tickets', archivedTicket.id, { status: 'done' })
  const externalProject = await create('projects', { name: 'External blockers' })
  const externalEpic = await create('epics', {
    project_id: externalProject.id,
    title: 'External prerequisites',
  })
  const blocker = await create('tickets', { epic_id: externalEpic.id, title: 'External blocker' })
  await create('links', { blocker_id: blocker.id, blocked_id: active.id })

  const historyURL = `${url}/api/tickets/${active.id}/history`
  const history = await (await page.request.get(historyURL)).json()
  assert.equal(history.history_complete, true)
  assert.equal(history.events.length, 6)
  await update('tickets', active.id, { status: 'in_progress', description: 'A non-status edit' })
  assert.equal((await (await page.request.get(historyURL)).json()).events.length, 6)

  await page.goto(`${url}/#project/${project.id}`)
  const tabs = page.getByRole('navigation', { name: 'Project views', exact: true })
  await tabs.getByRole('link', { name: 'Progress', exact: true }).click()
  await page.getByRole('heading', { name: 'Execution insights', exact: true }).waitFor()
  assert.equal(new URL(page.url()).hash, `#project/${project.id}/progress`)
  assert.equal(
    await tabs.getByRole('link', { name: 'Progress', exact: true }).getAttribute('aria-current'),
    'page',
  )
  assert.equal(
    await page
      .getByRole('navigation', { name: 'Breadcrumb', exact: true })
      .getByRole('link', { name: 'Progress', exact: true })
      .getAttribute('href'),
    `#project/${project.id}/progress`,
  )
  const metric = (name: string) =>
    page
      .locator('.execution-metric')
      .filter({ has: page.getByRole('heading', { name, exact: true }) })
      .locator('strong')
  assert.equal(await metric('Completed tickets').textContent(), '2 / 4')
  assert.equal(await metric('Active tickets').textContent(), '1')
  assert.equal(await metric('Blocked tickets').textContent(), '1')
  assert.notEqual(await metric('Median completion time').textContent(), '—')
  await page
    .locator('.untimed-section')
    .filter({ has: page.getByRole('heading', { name: /^Not started/ }) })
    .getByRole('link', { name: /Not started yet/ })
    .waitFor()
  await page
    .getByRole('img', { name: /^Ready for review:/ })
    .first()
    .waitFor()
  assert.equal(await page.locator('.timeline-ticket-link').count(), 3)
  await page.getByRole('button', { name: 'Collapse Delivery', exact: true }).click()
  assert.equal(await page.locator('.ticket-timeline-row:visible').count(), 1)
  await page.getByRole('button', { name: 'Expand Delivery', exact: true }).click()
  await page.getByLabel('Hide completed epics', { exact: true }).check()
  assert.equal(
    await page
      .locator('.timeline-label')
      .getByRole('link', { name: 'Archived work', exact: true })
      .count(),
    0,
  )
  await page.getByLabel('Hide completed epics', { exact: true }).uncheck()
  await page.getByLabel('Timeline range', { exact: true }).selectOption('3600')
  assert.equal(
    await page
      .getByRole('list', { name: 'Daily recorded completions', exact: true })
      .locator('li')
      .count(),
    28,
  )
  const completions = await page.locator('.throughput-value').allTextContents()
  assert.equal(
    completions.reduce((sum, value) => sum + Number(value), 0),
    3,
  )
  await page.getByRole('button', { name: 'Weekly', exact: true }).click()
  assert.equal(
    await page
      .getByRole('list', { name: 'Weekly recorded completions', exact: true })
      .locator('li')
      .count(),
    12,
  )

  // Live snapshots refresh the metrics without navigating or reloading.
  await update('tickets', active.id, { status: 'done' })
  await page.waitForFunction(
    () => document.querySelector('.execution-metric strong')?.textContent === '3 / 4',
  )
  assert.equal(await metric('Active tickets').textContent(), '0')
  assert.equal(await metric('Blocked tickets').textContent(), '0')
  const latest = await (
    await page.request.get(`${url}/api/projects/${project.id}/execution`)
  ).json()
  assert.equal(
    latest.daily_completions.reduce((sum: number, b: { tickets: number }) => sum + b.tickets, 0),
    3,
  )
  await page.locator('.timeline-ticket-link').filter({ hasText: 'Reopened implementation' }).click()
  await page.getByRole('heading', { name: 'Reopened implementation', exact: true }).waitFor()
  await page.goBack()
  await page.getByRole('heading', { name: 'Execution insights', exact: true }).waitFor()
  await page.reload()
  await page.getByRole('heading', { name: 'Execution insights', exact: true }).waitFor()

  // A representative legacy response tests the separate unavailable-history UI;
  // Go integration tests independently exercise the real v1 database migration.
  const executionRoute = `**/api/projects/${project.id}/execution`
  await page.route(executionRoute, async (route) => {
    const response = await route.fetch()
    const report = await response.json()
    const group = report.epics.find((e: { epic: { id: number } }) => e.epic.id === epic.id)
    const timing = group.tickets.find((t: { ticket: { id: number } }) => t.ticket.id === todo.id)
    timing.history_complete = false
    timing.timing_state = 'unavailable'
    for (const m of [report.metrics, group.metrics]) {
      m.not_started--
      m.partial_history++
      m.timing_unavailable++
    }
    await route.fulfill({ response, json: report })
  })
  await page.reload()
  await page.getByRole('note').filter({ hasText: 'incomplete history' }).waitFor()
  await page
    .locator('.untimed-section')
    .filter({ has: page.getByRole('heading', { name: /^Timing unavailable/ }) })
    .getByRole('link', { name: /Not started yet/ })
    .waitFor()
  await page.unroute(executionRoute)
  await page.reload()
  await page.getByRole('heading', { name: 'Execution insights', exact: true }).waitFor()
  // Dark palettes and mobile layouts use the same compact surfaces as the board.
  await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click()
  await page.getByRole('button', { name: 'Choose accent color', exact: true }).click()
  await page.getByRole('button', { name: 'Slate', exact: true }).click()
  assert.equal(
    await page
      .locator('.execution-metric')
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    'rgb(32, 37, 42)',
  )
  if (process.env.TINYTICKETS_SCREENSHOT)
    await page.screenshot({
      path: process.env.TINYTICKETS_SCREENSHOT,
      fullPage: true,
      animations: 'disabled',
    })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  const scroll = page.locator('.timeline-scroll')
  assert.equal(await scroll.evaluate((el) => el.scrollWidth > el.clientWidth), true)
  await tabs.getByRole('link', { name: 'Board', exact: true }).click()
  await page.locator('.board').waitFor()
  // Empty projects have zero counts and no invented timing values.
  const empty = await create('projects', { name: 'Empty progress project' })
  await page.goto(`${url}/#project/${empty.id}/progress`)
  await page.getByRole('heading', { name: 'Execution insights', exact: true }).waitFor()
  assert.equal(await metric('Completed tickets').textContent(), '0 / 0')
  assert.equal(await metric('Median completion time').textContent(), '—')
})
