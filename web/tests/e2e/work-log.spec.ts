import assert from 'node:assert/strict'
import type { Route } from 'playwright/test'
import { test } from './fixtures'
import { api } from './helpers/api'

test('ordered work logs and review handoffs preserve drafts, timing and archived access', async ({
  page,
  serverURL: url,
}) => {
  const { create } = api(page.request, url)
  const project = await create('projects', { name: 'Work log coverage' })
  const epic = await create('epics', { project_id: project.id, title: 'Notes and review handoffs' })
  const ticket = await create('tickets', {
    epic_id: epic.id,
    title: 'Chronological work log',
    description: 'Original **specification** stays intact.',
    status: 'in_progress',
  })
  const getTicket = async () => (await page.request.get(`${url}/api/tickets/${ticket.id}`)).json()
  const getLog = async () =>
    (await page.request.get(`${url}/api/tickets/${ticket.id}/work-log`)).json()
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`${url}/#ticket/${ticket.id}`)
  const log = page.locator('.ticket-work-log')
  const entries = log.locator('.work-log-entry')
  await log.getByText('No work log entries yet.', { exact: true }).waitFor()
  await log.locator('summary').focus()
  await page.keyboard.press('Enter')
  await log.getByLabel('Author (optional)', { exact: true }).fill('Agent <one>')
  await log
    .getByLabel('Log entry', { exact: true })
    .fill(
      'First **progress** note.\n\n<script>window.logPwned=true</script>\n\n[unsafe](javascript:alert(1))',
    )
  await log.getByRole('button', { name: 'Add log entry', exact: true }).click()
  await log.getByText('Work log entry added.', { exact: true }).waitFor()
  await entries
    .first()
    .locator('strong')
    .filter({ hasText: /^progress$/ })
    .waitFor()
  assert.equal(await entries.first().locator('.work-log-author').textContent(), 'Agent <one>')
  assert.equal(await entries.locator('script').count(), 0)
  assert.equal(await entries.locator('a[href^="javascript:"]').count(), 0)
  assert.equal(
    await page.evaluate(() => (window as Window & { logPwned?: boolean }).logPwned),
    undefined,
  )
  let current = await getTicket()
  assert.equal(current.description, ticket.description)
  assert.equal(current.status_since, ticket.status_since)
  assert.equal(current.updated_at, ticket.updated_at)

  // Another agent's appends update the open page without losing a local draft.
  await log.getByLabel('Log entry', { exact: true }).fill('Unsaved local draft')
  await Promise.all([
    create(`tickets/${ticket.id}/work-log`, { body: 'Remote update A', author: 'Agent two' }),
    create(`tickets/${ticket.id}/work-log`, { body: 'Remote update B', author: 'Agent three' }),
  ])
  await page.waitForFunction(() => document.querySelectorAll('.work-log-entry').length === 3)
  assert.equal(
    await log.getByLabel('Log entry', { exact: true }).inputValue(),
    'Unsaved local draft',
  )
  let stored = await getLog()
  assert.deepEqual(
    await entries.evaluateAll((elements) => elements.map((el) => Number(el.dataset.entryId))),
    stored.entries.map((e: { id: number }) => e.id),
  )

  await log.getByLabel('Update type', { exact: true }).selectOption('review_handoff')
  await log.getByLabel('Summary', { exact: true }).fill('Implemented **ordered updates**')
  await log
    .getByLabel('Verification', { exact: true })
    .fill('Go and browser checks passed. Manual review not run.')
  await log
    .getByLabel('References (optional)', { exact: true })
    .fill('[Commit abc123](https://example.com/commit/abc123)')
  await log
    .getByLabel('Review notes (optional)', { exact: true })
    .fill('Check keyboard access and mobile layout.')
  await log.getByRole('button', { name: 'Save handoff & request review', exact: true }).click()
  await log
    .getByText('Review handoff saved. Ticket is ready for review.', { exact: true })
    .waitFor()
  await page.waitForFunction(() => document.querySelectorAll('.work-log-entry').length === 4)
  assert.equal(
    await page
      .getByRole('complementary', { name: 'Ticket details' })
      .getByLabel('Status', { exact: true })
      .inputValue(),
    'ready_for_review',
  )
  await entries.last().getByRole('heading', { name: 'Verification', exact: true }).waitFor()
  assert.equal(
    await entries
      .last()
      .getByRole('link', { name: 'Commit abc123', exact: true })
      .getAttribute('href'),
    'https://example.com/commit/abc123',
  )
  await entries
    .last()
    .getByText('Check keyboard access and mobile layout.', { exact: true })
    .waitFor()
  current = await getTicket()
  assert.equal(current.description, ticket.description)
  assert.equal(typeof current.status_since, 'string')
  const reviewSince = current.status_since

  // Adding another handoff while in review must preserve the review anchor.
  await log.getByLabel('Summary', { exact: true }).fill('Additional review context')
  await log.getByLabel('Verification', { exact: true }).fill('Not rerun; context only')
  await log.getByRole('button', { name: 'Save handoff & request review', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.work-log-entry').length === 5)
  assert.equal((await getTicket()).status_since, reviewSince)
  const history = await (await page.request.get(`${url}/api/tickets/${ticket.id}/history`)).json()
  assert.equal(history.events.length, 2)

  // Failed submissions retain drafts, show an actionable error, and add nothing.
  await log.getByLabel('Update type', { exact: true }).selectOption('note')
  await log.getByLabel('Log entry', { exact: true }).fill('Retry this note')
  const failPost = async (route: Route) => {
    if (route.request().method() === 'POST')
      await route.fulfill({ status: 503, json: { error: 'Temporary log failure' } })
    else await route.continue()
  }
  await page.route(`**/api/tickets/${ticket.id}/work-log`, failPost)
  await log.getByRole('button', { name: 'Add log entry', exact: true }).click()
  await log.getByRole('alert').filter({ hasText: 'Temporary log failure' }).waitFor()
  assert.equal(await log.getByLabel('Log entry', { exact: true }).inputValue(), 'Retry this note')
  assert.equal((await getLog()).entries.length, 5)
  await page.unroute(`**/api/tickets/${ticket.id}/work-log`, failPost)
  await log.getByRole('button', { name: 'Add log entry', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.work-log-entry').length === 6)
  assert.equal((await getTicket()).status_since, reviewSince)

  // Read failures have a retry path, and reloads preserve append order.
  const failGet = (route: Route) =>
    route.fulfill({ status: 503, json: { error: 'Log temporarily unavailable' } })
  await page.route(`**/api/tickets/${ticket.id}/work-log`, failGet)
  await page.reload()
  await log.getByRole('button', { name: 'Retry loading log', exact: true }).waitFor()
  await page.unroute(`**/api/tickets/${ticket.id}/work-log`, failGet)
  await log.getByRole('button', { name: 'Retry loading log', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.work-log-entry').length === 6)
  stored = await getLog()
  assert.deepEqual(
    await entries.evaluateAll((elements) => elements.map((el) => Number(el.dataset.entryId))),
    stored.entries.map((e: { id: number }) => e.id),
  )
  assert.equal(await entries.getByRole('button', { name: /edit|delete/i }).count(), 0)

  // Archive access, long words, both themes and mobile layouts remain supported.
  const archived = await page.request.patch(`${url}/api/epics/${epic.id}`, {
    data: { completed: true, archived: true },
  })
  assert.equal(archived.status(), 200)
  await page.getByText('Archived epic', { exact: true }).waitFor()
  await create(`tickets/${ticket.id}/work-log`, { body: `Archived follow-up: ${'x'.repeat(400)}` })
  await page.waitForFunction(() => document.querySelectorAll('.work-log-entry').length === 7)
  for (const theme of ['light', 'dark']) {
    const currentTheme = await page.locator('html').getAttribute('data-theme')
    if (currentTheme !== theme)
      await page.getByRole('button', { name: `Switch to ${theme} mode`, exact: true }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    )
    await page.setViewportSize({ width: 1440, height: 1000 })
  }
  const other = await create('tickets', { epic_id: epic.id, title: 'Unrelated empty work log' })
  await page.goto(`${url}/#ticket/${other.id}`)
  await log.getByText('No work log entries yet.', { exact: true }).waitFor()
  assert.equal(await entries.count(), 0)
  await page.goto(`${url}/#ticket/${ticket.id}`)
  await page.waitForFunction(() => document.querySelectorAll('.work-log-entry').length === 7)
})
