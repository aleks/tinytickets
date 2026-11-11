import type { Page, Route } from 'playwright/test'
import { test, expect } from './fixtures'
import { api } from './helpers/api'

async function openParentDelete(page: Page, kind: 'project' | 'epic') {
  const menu = page.locator('details.more-menu')
  if (!(await menu.evaluate((element: HTMLDetailsElement) => element.open)))
    await menu.locator('summary').click()
  await page.getByRole('button', { name: `Delete ${kind}`, exact: true }).click()
  return page.getByRole('dialog', { name: `Delete ${kind}`, exact: true })
}

test('an in-flight deletion blocks duplicate submission and dismissal until it completes', async ({
  page,
  request,
  serverURL: url,
}) => {
  const { create } = api(request, url)
  const project = await create('projects', { name: 'Pending deletion' })
  await page.goto(`${url}/#project/${project.id}`)
  const dialog = await openParentDelete(page, 'project')
  const remove = dialog.getByRole('button', { name: 'Delete project', exact: true })
  await expect(remove).toBeEnabled()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let requests = 0
  await page.route(`**/api/projects/${project.id}`, async (route) => {
    if (route.request().method() === 'DELETE') {
      requests++
      await gate
    }
    await route.continue()
  })
  try {
    await remove.click()
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled()
    await expect(dialog.getByRole('button', { name: /Delet/i })).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    expect(requests).toBe(1)
  } finally {
    release()
  }
  await expect(page).toHaveURL(`${url}/#projects`)
})

test('project force deletion previews aggregate impact, includes archives and preserves external tickets', async ({
  page,
  request,
  serverURL: url,
}) => {
  const { create } = api(request, url)
  const project = await create('projects', { name: 'Cascading project fixture' })
  const active = await create('epics', { project_id: project.id, title: 'Hidden child name A' })
  const archived = await create('epics', {
    project_id: project.id,
    title: 'Hidden child name B',
    completed: true,
    archived: true,
  })
  const first = await create('tickets', {
    epic_id: active.id,
    title: 'Private ticket name A',
    status: 'in_progress',
  })
  const second = await create('tickets', { epic_id: archived.id, title: 'Private ticket name B' })
  await create(`tickets/${first.id}/work-log`, { body: 'Preserved until confirmed deletion' })
  await create(`tickets/${first.id}/review-handoff`, {
    summary: 'Review context',
    verification: 'Seeded test fixture',
  })
  await create('links', { blocker_id: first.id, blocked_id: second.id })
  const foreign = await create('projects', { name: 'Surviving project' })
  const foreignEpic = await create('epics', { project_id: foreign.id, title: 'Surviving epic' })
  const survivor = await create('tickets', {
    epic_id: foreignEpic.id,
    title: 'Surviving dependent',
  })
  await create('links', { blocker_id: first.id, blocked_id: survivor.id })
  expect((await request.delete(`${url}/api/projects/${project.id}`)).status()).toBe(409)

  await page.goto(`${url}/#project/${project.id}`)
  const dialog = await openParentDelete(page, 'project')
  const force = dialog.getByRole('checkbox', { name: /^Force delete/ })
  const remove = dialog.getByRole('button', { name: 'Delete project', exact: true })
  await expect(force).not.toBeChecked()
  await expect(remove).toBeDisabled()
  await expect(dialog).toContainText(project.name)
  await expect(dialog).toContainText(/2 epics/)
  await expect(dialog).toContainText(/2 tickets/)
  await expect(dialog).toContainText(/archived/i)
  await expect(dialog).not.toContainText(active.title)
  await expect(dialog).not.toContainText(first.title)
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  expect((await request.get(`${url}/api/projects/${project.id}`)).ok()).toBe(true)
  await openParentDelete(page, 'project')
  await force.check()
  await expect(dialog).toContainText(/work logs/i)
  await expect(dialog).toContainText(/review handoffs/i)
  await expect(dialog).toContainText(/status history/i)
  await expect(dialog).toContainText(/dependency links/i)
  await expect(dialog).toContainText(/cannot be undone/i)
  await expect(dialog).toContainText(/outside/i)
  await expect(remove).toBeEnabled()
  await remove.click()
  await expect(page).toHaveURL(`${url}/#projects`)
  expect((await request.get(`${url}/api/projects/${project.id}`)).status()).toBe(404)
  for (const ticket of [first, second])
    expect((await request.get(`${url}/api/tickets/${ticket.id}`)).status()).toBe(404)
  expect((await request.get(`${url}/api/epics/${archived.id}`)).status()).toBe(404)
  const state = await (await request.get(`${url}/api/state`)).json()
  expect(state.projects.map((p: { id: number }) => p.id)).toEqual([foreign.id])
  expect(state.tickets.map((t: { id: number }) => t.id)).toEqual([survivor.id])
  expect(state.links).toEqual([])
  const ready = await (
    await request.get(`${url}/api/tickets/ready?project_id=${foreign.id}`)
  ).json()
  expect(ready.tickets.map((t: { id: number }) => t.id)).toEqual([survivor.id])
  const report = await (await request.get(`${url}/api/projects/${foreign.id}/execution`)).json()
  expect(report.metrics.total).toBe(1)
})

test('same-count replacement after preview requires a fresh force confirmation without deleting anything', async ({
  page,
  request,
  serverURL: url,
}) => {
  const { create } = api(request, url)
  const project = await create('projects', { name: 'Stale deletion confirmation' })
  const epic = await create('epics', { project_id: project.id, title: 'Changing contents' })
  const old = await create('tickets', { epic_id: epic.id, title: 'Original child' })
  await page.goto(`${url}/#epic/${epic.id}`)
  const dialog = await openParentDelete(page, 'epic')
  const force = dialog.getByRole('checkbox', { name: /^Force delete/ })
  const remove = dialog.getByRole('button', { name: 'Delete epic', exact: true })
  await force.check()
  expect((await request.delete(`${url}/api/tickets/${old.id}`)).ok()).toBe(true)
  const replacement = await create('tickets', {
    epic_id: epic.id,
    title: 'New child with same count',
  })
  let deletes = 0
  page.on('request', (r) => {
    if (r.method() === 'DELETE' && r.url() === `${url}/api/epics/${epic.id}`) deletes++
  })
  await remove.click()
  await expect(dialog.getByRole('alert')).toContainText(/changed|review|confirm again/i)
  await expect(force).not.toBeChecked()
  await expect(remove).toBeDisabled()
  expect(deletes).toBe(1)
  expect((await request.get(`${url}/api/tickets/${replacement.id}`)).ok()).toBe(true)
  await force.check()
  await remove.click()
  await expect(page).toHaveURL(`${url}/#project/${project.id}`)
  expect(deletes).toBe(2)
  expect((await request.get(`${url}/api/tickets/${replacement.id}`)).status()).toBe(404)
})

test('archived epic force deletion navigates to its project and leaves sibling work intact', async ({
  page,
  request,
  serverURL: url,
}) => {
  const { create } = api(request, url)
  const project = await create('projects', { name: 'Archived epic deletion' })
  const epic = await create('epics', {
    project_id: project.id,
    title: 'Archived target',
    completed: true,
    archived: true,
  })
  const child = await create('tickets', { epic_id: epic.id, title: 'Archived child' })
  const sibling = await create('epics', { project_id: project.id, title: 'Keep this epic' })
  const survivor = await create('tickets', { epic_id: sibling.id, title: 'Keep this ticket' })
  await create('links', { blocker_id: child.id, blocked_id: survivor.id })
  await page.goto(`${url}/#epic/${epic.id}`)
  const dialog = await openParentDelete(page, 'epic')
  const remove = dialog.getByRole('button', { name: 'Delete epic', exact: true })
  await expect(remove).toBeDisabled()
  await dialog.getByRole('checkbox', { name: /^Force delete/ }).check()
  await remove.click()
  await expect(page).toHaveURL(`${url}/#project/${project.id}`)
  await expect(page.getByRole('heading', { name: sibling.title, exact: true })).toBeVisible()
  expect((await request.get(`${url}/api/tickets/${survivor.id}`)).ok()).toBe(true)
  expect((await request.get(`${url}/api/tickets/${child.id}`)).status()).toBe(404)
})

test('ticket deletion cancellation keeps editor drafts and one focus trap; deletion returns to its epic', async ({
  page,
  request,
  serverURL: url,
}) => {
  const { create } = api(request, url)
  const project = await create('projects', { name: 'Ticket delete draft fixture' })
  const epic = await create('epics', { project_id: project.id, title: 'Ticket parent' })
  const ticket = await create('tickets', {
    epic_id: epic.id,
    title: 'Original title',
    description: 'Original description',
  })
  await create(`tickets/${ticket.id}/work-log`, { body: 'History removed with ticket' })
  await page.goto(`${url}/#ticket/${ticket.id}`)
  await page.getByRole('button', { name: 'Edit ticket', exact: true }).click()
  await page.getByRole('dialog').getByLabel('Title', { exact: true }).fill('Unsent edited title')
  await page
    .getByRole('dialog')
    .getByLabel('Description', { exact: true })
    .fill('Unsent edited description')
  await page.getByRole('button', { name: 'Delete ticket', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete ticket', exact: true })
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await expect(dialog.getByRole('checkbox', { name: /^Force delete/ })).toHaveCount(0)
  const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true })
  await expect(cancel).toBeFocused()
  await cancel.focus()
  await page.keyboard.press('Shift+Tab')
  expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog').getByLabel('Title', { exact: true })).toHaveValue(
    'Unsent edited title',
  )
  await expect(page.getByRole('dialog').getByLabel('Description', { exact: true })).toHaveValue(
    'Unsent edited description',
  )
  expect((await (await request.get(`${url}/api/tickets/${ticket.id}`)).json()).title).toBe(
    ticket.title,
  )
  await page.getByRole('button', { name: 'Delete ticket', exact: true }).click()
  await dialog.getByRole('button', { name: 'Delete ticket', exact: true }).click()
  await expect(page).toHaveURL(`${url}/#epic/${epic.id}`)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect((await request.get(`${url}/api/tickets/${ticket.id}`)).status()).toBe(404)
})

test('preview and deletion errors remain actionable without automatic write retries, including mobile dark mode', async ({
  page,
  request,
  serverURL: url,
}) => {
  const { create } = api(request, url)
  const project = await create('projects', {
    name: 'A very long project name for destructive modal responsive overflow checks',
  })
  await page.addInitScript(() => localStorage.setItem('theme', 'dark'))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${url}/#project/${project.id}`)
  const previewURL = `**/api/projects/${project.id}/deletion-preview`
  const failPreview = (route: Route) =>
    route.fulfill({ status: 503, json: { error: 'Preview temporarily unavailable' } })
  await page.route(previewURL, failPreview)
  const dialog = await openParentDelete(page, 'project')
  const remove = dialog.getByRole('button', { name: 'Delete project', exact: true })
  await expect(dialog.getByRole('alert')).toContainText('Preview temporarily unavailable')
  await expect(remove).toBeDisabled()
  await page.unroute(previewURL, failPreview)
  await dialog.getByRole('button', { name: /Retry/i }).click()
  await expect(remove).toBeEnabled()
  await expect(dialog.getByRole('checkbox', { name: /^Force delete/ })).toHaveCount(0)
  let requests = 0
  const failDelete = async (route: Route) => {
    if (route.request().method() === 'DELETE') {
      requests++
      await route.fulfill({ status: 503, json: { error: 'Deletion temporarily unavailable' } })
    } else await route.continue()
  }
  await page.route(`**/api/projects/${project.id}`, failDelete)
  await remove.click()
  await expect(dialog.getByRole('alert')).toContainText('Deletion temporarily unavailable')
  await page.waitForTimeout(150)
  expect(requests).toBe(1)
  expect((await request.get(`${url}/api/projects/${project.id}`)).ok()).toBe(true)
  expect(
    await dialog.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      return (
        bounds.left >= 0 && bounds.right <= innerWidth && element.scrollWidth <= element.clientWidth
      )
    }),
  ).toBe(true)
  await page.unroute(`**/api/projects/${project.id}`, failDelete)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await openParentDelete(page, 'project')
  await remove.click()
  await expect(page).toHaveURL(`${url}/#projects`)
})
