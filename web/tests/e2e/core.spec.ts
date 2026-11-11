import { test, expect } from './fixtures'
import { api, type Epic, type Project, type Ticket } from './helpers/api'
import { seedBoard } from './helpers/seeds'

test('empty workspace creation and entity breadcrumb links', async ({ page, serverURL: url }) => {
  await page.goto(url)
  await expect(page.getByText('No epics yet', { exact: true })).toBeVisible()
  await page.locator('aside').getByRole('button', { name: 'New project', exact: true }).click()
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('TinyTickets')
  await page.getByRole('button', { name: 'Create project', exact: true }).click()
  await page.locator('aside').getByRole('button', { name: 'New epic', exact: true }).click()
  await page.getByRole('dialog').getByLabel('Title', { exact: true }).fill('First release')
  await page.getByRole('button', { name: 'Create epic', exact: true }).click()
  await expect(page.locator('.nav-epic-project').filter({ hasText: /^TinyTickets$/ })).toBeVisible()
  const state: { projects: Project[]; epics: Epic[] } = await (
    await page.request.get(`${url}/api/state`)
  ).json()
  const project = state.projects.find((project) => project.name === 'TinyTickets')!
  const epic = state.epics.find((epic) => epic.title === 'First release')!
  const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb', exact: true })
  await page.locator('.epic-card').click()
  await expect(breadcrumb.getByRole('link', { name: epic.title, exact: true })).toHaveAttribute(
    'href',
    `#epic/${epic.id}`,
  )
  await expect(breadcrumb.getByRole('link', { name: epic.title, exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await breadcrumb.getByRole('link', { name: project.name, exact: true }).click()
  await expect(page.getByRole('heading', { name: project.name, exact: true })).toBeVisible()
  await expect(page).toHaveURL(`${url}/#project/${project.id}`)
  await breadcrumb.getByRole('link', { name: 'Projects', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
  await breadcrumb.getByRole('link', { name: 'Workspace', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()
  await page
    .locator('aside')
    .getByRole('button', { name: /^Epics/ })
    .click()
  await expect(breadcrumb.getByRole('link', { name: 'Epics', exact: true })).toHaveAttribute(
    'href',
    '#epics',
  )
  await breadcrumb.getByRole('link', { name: 'Workspace', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()
})

test('ticket creation, dependencies, drag persistence and concurrent status changes', async ({
  page,
  serverURL: url,
}) => {
  const { create, patch } = api(page.request, url)
  const project = await create('projects', { name: 'TinyTickets' })
  await create('epics', { project_id: project.id, title: 'First release' })
  await page.goto(url)
  await page.getByRole('button', { name: 'New ticket', exact: true }).click()
  await page.getByLabel('Title', { exact: true }).fill('Build the board')
  await page
    .getByLabel('Description', { exact: true })
    .fill('A functional board with live updates.')
  await page.getByRole('button', { name: 'Create ticket', exact: true }).click()
  await page.getByRole('button', { name: 'New ticket', exact: true }).click()
  await page.getByLabel('Title', { exact: true }).fill('Review the release')
  await page.getByRole('button', { name: 'Create ticket', exact: true }).click()
  await expect(page.locator('.ticket-card')).toHaveCount(2)
  const state: { tickets: Ticket[] } = await (await page.request.get(`${url}/api/state`)).json()
  const ticket = state.tickets.find((ticket) => ticket.title === 'Build the board')!
  await page.locator('.ticket-card').filter({ hasText: 'Review the release' }).click()
  await page.getByLabel('Linked ticket', { exact: true }).selectOption(String(ticket.id))
  await page.getByRole('button', { name: 'Link', exact: true }).click()
  await expect(page.locator('.dependency-row')).toBeVisible()
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.locator('.blocked-badge')).toHaveCount(1)
  await page
    .locator('.ticket-card')
    .filter({ hasText: 'Build the board' })
    .dragTo(page.locator('.column-in_progress'))
  await expect(page.locator('.column-in_progress .ticket-card')).toBeVisible()
  expect((await (await page.request.get(`${url}/api/tickets/${ticket.id}`)).json()).status).toBe(
    'in_progress',
  )
  await patch('tickets', ticket.id, { status: 'ready_for_review' })
  await expect(page.locator('.column-ready_for_review .ticket-card')).toBeVisible()
  await page.locator('.ticket-card').filter({ hasText: 'Build the board' }).click()
  await page.getByLabel('Title', { exact: true }).fill('Board is ready')
  await patch('tickets', ticket.id, { status: 'done' })
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(
    page.locator('.column-done .ticket-card').filter({ hasText: 'Board is ready' }),
  ).toBeVisible()
  await expect(page.locator('.blocked-badge')).toHaveCount(0)
})

test('completing the only epic hides its tickets and reopening restores the overview', async ({
  page,
  serverURL: url,
}) => {
  await seedBoard(page, url)
  await page.goto(url)
  await page.locator('.epic-card').click()
  await page.getByRole('button', { name: 'Complete epic', exact: true }).click()
  await page.getByRole('button', { name: /Overview/ }).click()
  await expect(page.getByText('All epics completed', { exact: true })).toBeVisible()
  await expect(page.locator('.ticket-card')).toHaveCount(0)
  await page.locator('aside').getByRole('button', { name: 'Epics', exact: false }).first().click()
  await page.locator('.epic-card').click()
  await page.getByRole('button', { name: 'Reopen epic', exact: true }).click()
  await page.getByRole('button', { name: /Overview/ }).click()
  await expect(page.locator('.epic-card')).toBeVisible()
})
