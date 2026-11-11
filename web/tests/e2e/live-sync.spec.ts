import { test, expect } from './fixtures'
import { api } from './helpers/api'
import { appendThroughStdio } from './helpers/stdio'

test('initial SSE sync and ordinary note submission avoid duplicate workspace reads', async ({
  page,
  request,
  serverURL,
}) => {
  const client = api(request, serverURL)
  const project = await client.create('projects', { name: 'Request coordination' })
  const epic = await client.create('epics', { project_id: project.id, title: 'Sync' })
  const ticket = await client.create('tickets', { epic_id: epic.id, title: 'Coalesced refreshes' })
  let reads = 0
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/state') reads++
  })
  await page.goto(`${serverURL}/#ticket/${ticket.id}`)
  await expect(page.getByText('No work log entries yet.', { exact: true })).toBeVisible()
  // Account for queued SSE work well before the 15-second fallback interval.
  await page.waitForTimeout(200)
  expect(reads).toBe(1)
  await page.locator('.work-log-composer summary').click()
  await page.getByLabel('Log entry', { exact: true }).fill('One write, one coordinated refresh')
  await page.getByRole('button', { name: 'Add log entry', exact: true }).click()
  await expect(page.getByText('Work log entry added.', { exact: true })).toBeVisible()
  await page.waitForTimeout(200)
  expect(reads).toBe(2)
})

test('separate stdio log-only writes update open pages without losing drafts or timing', async ({
  page,
  request,
  serverURL,
  databasePath,
}) => {
  const client = api(request, serverURL)
  const project = await client.create('projects', { name: 'External log synchronization' })
  const epic = await client.create('epics', { project_id: project.id, title: 'Sync' })
  const ticket = await client.create('tickets', {
    epic_id: epic.id,
    title: 'Stdio live updates',
    status: 'in_progress',
  })
  await page.goto(`${serverURL}/#ticket/${ticket.id}`)
  await expect(page.getByText('No work log entries yet.', { exact: true })).toBeVisible()
  await page.locator('.work-log-composer summary').click()
  await page.getByLabel('Log entry', { exact: true }).fill('My unsent draft')
  await appendThroughStdio(databasePath, ticket.id, 'External stdio progress note')
  await expect(
    page.locator('.work-log-entry').getByText('External stdio progress note', { exact: true }),
  ).toBeVisible()
  await expect(page.getByLabel('Log entry', { exact: true })).toHaveValue('My unsent draft')
  const after = await (await request.get(`${serverURL}/api/tickets/${ticket.id}`)).json()
  expect(after.updated_at).toBe(ticket.updated_at)
  expect(after.status_since).toBe(ticket.status_since)
})
