import assert from 'node:assert/strict'

export async function testColumnTimers(page, url) {
  const create = async (kind, data) => {
    const response = await page.request.post(`${url}/api/${kind}`, { data })
    assert.equal(response.status(), 201)
    return response.json()
  }
  const change = async (id, data) => {
    const response = await page.request.patch(`${url}/api/tickets/${id}`, { data })
    assert.equal(response.status(), 200)
    return response.json()
  }
  const project = await create('projects', { name: 'Column timers' })
  const epic = await create('epics', { project_id: project.id, title: 'Column timer coverage' })
  const active = await create('tickets', { epic_id: epic.id, title: 'Current progress clock', status: 'in_progress' })
  const review = await create('tickets', { epic_id: epic.id, title: 'Current review clock', status: 'ready_for_review' })
  const todo = await create('tickets', { epic_id: epic.id, title: 'Untimed todo clock' })
  const done = await create('tickets', { epic_id: epic.id, title: 'Untimed done clock', status: 'done' })
  assert.equal(typeof active.status_since, 'string')
  assert.equal(typeof review.status_since, 'string')
  assert.equal(todo.status_since, null)
  assert.equal(done.status_since, null)

  let stateRequests = 0
  const countRequest = request => { if (new URL(request.url()).pathname === '/api/state') stateRequests++ }
  page.on('request', countRequest)
  const card = title => page.locator('.ticket-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
  const timer = () => card(active.title).locator('.ticket-column-timer')
  const waitSeconds = async (title, seconds) => {
    await page.waitForFunction(({ title, seconds }) => {
      const card = Array.from(document.querySelectorAll('.ticket-card')).find(el => el.querySelector('h4')?.textContent === title)
      const elapsed = card?.querySelector('.ticket-column-timer')?.getAttribute('data-elapsed-seconds')
      return elapsed !== null && elapsed !== undefined && Number(elapsed) >= seconds
    }, { title, seconds })
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`${url}/#project/${project.id}`)
  // Hash-only navigation can reuse the previous page's 15-second fallback
  // interval. Reload so the local-tick request assertion has a fresh window.
  await page.reload()
  await card(active.title).waitFor()
  if (await page.getByRole('button', { name: 'Switch to light mode', exact: true }).count()) await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click()
  assert.equal(await card(todo.title).locator('.ticket-column-timer').count(), 0)
  assert.equal(await card(done.title).locator('.ticket-column-timer').count(), 0)
  await waitSeconds(active.title, 2)
  await waitSeconds(review.title, 2)
  const requestsBeforeTicks = stateRequests
  const beforeTick = Number(await timer().getAttribute('data-elapsed-seconds'))
  await waitSeconds(active.title, beforeTick + 2)
  // Local ticks do not fetch per-ticket history, poll per second, or write time.
  assert.equal(stateRequests, requestsBeforeTicks)
  const historyBefore = await (await page.request.get(`${url}/api/tickets/${active.id}/history`)).json()
  assert.equal(historyBefore.events.length, 1)
  const edited = await change(active.id, { title: active.title, description: 'An ordinary edit', status: 'in_progress' })
  assert.equal(edited.status_since, active.status_since)
  await page.reload()
  await waitSeconds(active.title, beforeTick + 2)
  assert.equal(await timer().getAttribute('data-status-since'), active.status_since)

  // Dragging progress -> review starts a new column counter, not paused work.
  await card(active.title).dragTo(page.locator('.column-ready_for_review'))
  await page.locator('.column-ready_for_review').locator('.ticket-card').filter({ hasText: active.title }).waitFor()
  const inReview = await (await page.request.get(`${url}/api/tickets/${active.id}`)).json()
  assert.notEqual(inReview.status_since, active.status_since)
  assert.equal(await timer().getAttribute('data-status-since'), inReview.status_since)
  assert.ok(Number(await timer().getAttribute('data-elapsed-seconds')) <= 2)
  await waitSeconds(active.title, 2)
  const inProgress = await change(active.id, { status: 'in_progress' })
  await page.locator('.column-in_progress').locator('.ticket-card').filter({ hasText: active.title }).waitFor()
  assert.notEqual(inProgress.status_since, inReview.status_since)
  assert.equal(await timer().getAttribute('data-status-since'), inProgress.status_since)
  assert.ok(Number(await timer().getAttribute('data-elapsed-seconds')) <= 2)
  for (const status of ['todo', 'done']) {
    const moved = await change(active.id, { status })
    await page.locator(`.column-${status}`).locator('.ticket-card').filter({ hasText: active.title }).waitFor()
    assert.equal(moved.status_since, null)
    assert.equal(await timer().count(), 0)
  }
  await change(active.id, { status: 'ready_for_review' })
  await page.locator('.column-ready_for_review').locator('.ticket-card').filter({ hasText: active.title }).waitFor()
  assert.ok(Number(await timer().getAttribute('data-elapsed-seconds')) <= 2)
  await change(active.id, { status: 'in_progress' })
  await page.locator('.column-in_progress').locator('.ticket-card').filter({ hasText: active.title }).waitFor()

  // Deterministic display fixtures exercise long times, missing legacy entry
  // dates, and clock skew. Backend tests verify genuine history derivation.
  page.off('request', countRequest)
  const fixed = Date.parse('2026-11-09T12:00:00.000Z')
  await page.clock.setFixedTime(new Date(fixed))
  let since = new Date(fixed).toISOString()
  await page.route('**/api/state', async route => {
    const response = await route.fetch()
    const state = await response.json()
    state.tickets.find(t => t.id === active.id).status_since = since
    await route.fulfill({ response, json: state })
  })
  for (const [seconds, display] of [[0, '0:00'], [59, '0:59'], [60, '1:00'], [3599, '59:59'], [3600, '1:00:00'], [86399, '23:59:59'], [86400, '1d 00:00:00'], [90061, '1d 01:01:01']]) {
    since = new Date(fixed - seconds * 1000).toISOString()
    await page.reload()
    await timer().waitFor()
    assert.equal(await timer().getAttribute('data-elapsed-seconds'), String(seconds))
    assert.equal(await timer().locator('time').textContent(), display)
    assert.equal(await timer().locator('time').getAttribute('datetime'), `PT${seconds}S`)
  }
  for (const missing of [null, 'invalid-date']) {
    since = missing
    await page.reload()
    await card(active.title).getByLabel('In progress column time unavailable', { exact: true }).waitFor()
    assert.equal(await timer().getAttribute('data-elapsed-seconds'), null)
    assert.equal(await timer().textContent(), '—')
  }
  since = new Date(fixed + 3600000).toISOString()
  await page.reload()
  await timer().waitFor()
  assert.equal(await timer().locator('time').textContent(), '0:00')
  await page.clock.setFixedTime(new Date(fixed + 3605000))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.waitForFunction(title => {
    const card = Array.from(document.querySelectorAll('.ticket-card')).find(el => el.querySelector('h4')?.textContent === title)
    return card?.querySelector('.ticket-column-timer')?.getAttribute('data-elapsed-seconds') === '5'
  }, active.title)
  assert.equal(await timer().locator('time').textContent(), '0:05')
  await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  assert.equal(await card(review.title).locator('.ticket-column-timer').count(), 1)
  assert.equal(await card(todo.title).locator('.ticket-column-timer').count(), 0)
  assert.equal(await card(done.title).locator('.ticket-column-timer').count(), 0)
  await page.unroute('**/api/state')
}
