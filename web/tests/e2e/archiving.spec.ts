import assert from 'node:assert/strict'
import { test, expect } from './fixtures'
import { api } from './helpers/api'

test('project archive toggle is scoped, keyboard accessible, and preserves ordinary board filtering', async ({
  page,
  serverURL: url,
}) => {
  const { create, patch } = api(page.request, url)
  const project = await create('projects', { name: 'Project with archives' })
  const other = await create('projects', { name: 'Other project with archives' })
  await create('epics', { project_id: project.id, title: 'Ordinary epic' })
  const archived = await create('epics', {
    project_id: project.id,
    title: 'Local archived epic',
    completed: true,
    archived: true,
  })
  await create('tickets', { epic_id: archived.id, title: 'Archived ticket stays off board' })
  await create('epics', {
    project_id: other.id,
    title: 'Other archived epic',
    completed: true,
    archived: true,
  })
  await page.goto(`${url}/#project/${project.id}`)
  const archives = page.getByRole('region', { name: 'Archived epics', exact: true })
  const toggle = page.getByRole('button', { name: 'Show archived epics (1)', exact: true })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(archives).toBeHidden()
  await toggle.focus()
  await page.keyboard.press('Enter')
  const hide = page.getByRole('button', { name: 'Hide archived epics (1)', exact: true })
  await expect(hide).toHaveAttribute('aria-expanded', 'true')
  const sectionID = await hide.getAttribute('aria-controls')
  await expect(archives).toHaveAttribute('id', sectionID!)
  await expect(archives.getByRole('heading', { name: archived.title, exact: true })).toBeVisible()
  await expect(page.locator('.epic-card')).toHaveCount(2)
  await expect(page.locator('.ticket-card')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Other archived epic', exact: true })).toHaveCount(
    0,
  )
  await hide.focus()
  await page.keyboard.press('Space')
  await expect(archives).toBeHidden()
  await toggle.click()

  // Expansion is local to a project, not inherited by another project or persisted on reload.
  await page.goto(`${url}/#project/${other.id}`)
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.click()
  await expect(
    archives.getByRole('heading', { name: 'Other archived epic', exact: true }),
  ).toBeVisible()
  await page.goto(`${url}/#project/${project.id}`)
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.click()
  await page.reload()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.click()

  await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(hide).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await archives.getByRole('button', { name: 'Unarchive Local archived epic', exact: true }).click()
  await expect(page.getByRole('button', { name: /archived epics \(/ })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: archived.title, exact: true })).toBeVisible()
  await expect(page.locator('.epic-card').filter({ hasText: archived.title })).toContainText(
    'Completed',
  )

  // An archive arriving via live refresh exposes the control without changing the board.
  await patch('epics', archived.id, { archived: true })
  await expect(hide).toBeVisible()
  await expect(page.locator('.ticket-card')).toHaveCount(0)
  await archives.getByRole('heading', { name: archived.title, exact: true }).click()
  await expect(page).toHaveURL(`${url}/#epic/${archived.id}`)
  await expect(page.getByRole('button', { name: 'Unarchive epic', exact: true })).toBeVisible()
})

test('an archive-only project exposes its empty archived epic for deletion before deleting the project', async ({
  page,
  serverURL: url,
}) => {
  const { create } = api(page.request, url)
  const project = await create('projects', { name: 'Archive-only deletion project' })
  const archived = await create('epics', {
    project_id: project.id,
    title: 'Empty archived epic',
    completed: true,
    archived: true,
  })
  const empty = await create('projects', { name: 'Actually empty project' })
  await page.goto(`${url}/#project/${project.id}`)
  await expect(page.getByText('No unarchived epics', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Show archived epics (1)', exact: true }).click()
  await page
    .getByRole('region', { name: 'Archived epics', exact: true })
    .getByRole('heading', { name: archived.title, exact: true })
    .click()
  await page.getByLabel('Epic options', { exact: true }).click()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Delete epic', exact: true }).click()
  await expect(page).toHaveURL(`${url}/#epics`)
  expect((await page.request.get(`${url}/api/epics/${archived.id}`)).status()).toBe(404)
  await page.goto(`${url}/#project/${project.id}`)
  await expect(page.getByText('No epics yet', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /archived epics \(/ })).toHaveCount(0)
  await page.getByLabel('Project options', { exact: true }).click()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Delete project', exact: true }).click()
  await expect(page).toHaveURL(`${url}/#projects`)
  expect((await page.request.get(`${url}/api/projects/${project.id}`)).status()).toBe(404)
  await page.goto(`${url}/#project/${empty.id}`)
  await expect(page.getByText('No epics yet', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /archived epics \(/ })).toHaveCount(0)
})

test('archiving preserves data, links, metrics, editing and direct access', async ({
  page,
  serverURL: url,
}) => {
  const { create, patch } = api(page.request, url)
  const project = await create('projects', { name: 'Archive project' })
  const visible = await create('epics', { project_id: project.id, title: 'Visible archive work' })
  const candidate = await create('epics', { project_id: project.id, title: 'Archive candidate' })
  await create('epics', { project_id: project.id, title: 'Completed but visible', completed: true })
  const done = await create('tickets', {
    epic_id: candidate.id,
    title: 'Preserved archived delivery',
    status: 'in_progress',
  })
  await patch('tickets', done.id, { status: 'done' })
  const hidden = await create('tickets', {
    epic_id: candidate.id,
    title: 'Preserved unfinished archive work',
  })
  const visibleTicket = await create('tickets', {
    epic_id: visible.id,
    title: 'Still visible archive ticket',
  })
  await create('links', { blocker_id: hidden.id, blocked_id: visibleTicket.id })
  const historyBefore = await (
    await page.request.get(`${url}/api/tickets/${done.id}/history`)
  ).json()
  const reportBefore = await (
    await page.request.get(`${url}/api/projects/${project.id}/execution`)
  ).json()
  await page.setViewportSize({ width: 1440, height: 1000 })

  const editEpic = async () => {
    const menu = page.locator('details.more-menu')
    if (!(await menu.evaluate((el: HTMLDetailsElement) => el.open)))
      await menu.locator('summary').click()
    await page.getByRole('button', { name: 'Edit epic', exact: true }).click()
  }
  const sidebarCandidate = page
    .locator('.nav-epic-text > span:first-child')
    .filter({ hasText: /^Archive candidate$/ })
  await page.goto(`${url}/#epic/${candidate.id}`)
  await page.getByRole('heading', { name: 'Archive candidate', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Archive epic', exact: true }).count(), 0)
  await editEpic()
  assert.equal(
    await page.getByRole('checkbox', { name: 'Archived', exact: true }).isDisabled(),
    true,
  )
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Complete epic', exact: true }).click()
  await page.getByRole('button', { name: 'Archive epic', exact: true }).click()
  await page.getByRole('button', { name: 'Unarchive epic', exact: true }).waitFor()
  assert.equal(await sidebarCandidate.count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Reopen epic', exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: 'New ticket', exact: true }).count(), 0)
  assert.equal(await page.locator('.ticket-card').count(), 2) // Direct detail access is retained.
  await editEpic()
  assert.equal(
    await page.getByRole('checkbox', { name: 'Completed', exact: true }).isDisabled(),
    true,
  )
  assert.equal(
    await page.getByRole('checkbox', { name: 'Archived', exact: true }).isChecked(),
    true,
  )
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()

  await page
    .getByRole('navigation', { name: 'Breadcrumb', exact: true })
    .getByRole('link', { name: 'Workspace', exact: true })
    .click()
  await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor()
  assert.equal(await page.locator('.epic-card').filter({ hasText: 'Archive candidate' }).count(), 0)
  assert.equal(
    await page
      .locator('.ticket-card')
      .filter({ hasText: 'Preserved unfinished archive work' })
      .count(),
    0,
  )
  await page.goto(`${url}/#project/${project.id}`)
  await page.getByRole('heading', { name: project.name, exact: true }).waitFor()
  assert.equal(await page.locator('.epic-card').filter({ hasText: 'Archive candidate' }).count(), 0)
  assert.equal(
    await page.locator('.ticket-card').filter({ hasText: 'Preserved archived delivery' }).count(),
    0,
  )
  assert.equal(
    await page
      .locator('.ticket-card')
      .filter({ hasText: visibleTicket.title })
      .locator('.blocked-badge')
      .count(),
    1,
  )
  const snapshot = await (await page.request.get(`${url}/api/state`)).json()
  assert.equal(snapshot.epics.find((e: { id: number }) => e.id === candidate.id).archived, true)
  assert.equal(
    snapshot.tickets.some((t: { id: number }) => t.id === hidden.id),
    true,
  )
  assert.equal(
    snapshot.links.some(
      (l: { blocker_id: number; blocked_id: number }) =>
        l.blocker_id === hidden.id && l.blocked_id === visibleTicket.id,
    ),
    true,
  )
  await page.getByRole('button', { name: 'New ticket', exact: true }).click()
  assert.equal(
    await page
      .getByRole('dialog')
      .locator('option')
      .filter({ hasText: 'Archive candidate' })
      .count(),
    0,
  )
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()

  await page.goto(`${url}/#project/${project.id}/progress`)
  await page.getByRole('heading', { name: 'Execution insights', exact: true }).waitFor()
  await page.locator('.archive-metrics-note').filter({ hasText: '1 archived epic' }).waitFor()
  assert.equal(
    await page.locator('.timeline-label a').filter({ hasText: 'Archive candidate' }).count(),
    0,
  )
  assert.equal(
    await page
      .locator('.untimed-section a')
      .filter({ hasText: 'Preserved unfinished archive work' })
      .count(),
    0,
  )
  const reportAfter = await (
    await page.request.get(`${url}/api/projects/${project.id}/execution`)
  ).json()
  assert.equal(reportAfter.metrics.total, reportBefore.metrics.total)
  assert.equal(reportAfter.metrics.completed, reportBefore.metrics.completed)
  assert.equal(reportAfter.metrics.completion_samples, reportBefore.metrics.completion_samples)
  assert.equal(
    reportAfter.daily_completions.reduce(
      (sum: number, b: { tickets: number }) => sum + b.tickets,
      0,
    ),
    reportBefore.daily_completions.reduce(
      (sum: number, b: { tickets: number }) => sum + b.tickets,
      0,
    ),
  )
  assert.equal(
    reportAfter.epics.some((e: { epic: { id: number } }) => e.epic.id === candidate.id),
    false,
  )
  assert.equal(reportAfter.epics_archived, 1)
  assert.deepEqual(
    (await (await page.request.get(`${url}/api/tickets/${done.id}/history`)).json()).events,
    historyBefore.events,
  )

  // Direct ticket links and edits retain the current archived parent, without
  // offering archived epics as ordinary reassignment targets.
  await page.goto(`${url}/#ticket/${done.id}`)
  await page.getByRole('heading', { name: done.title, exact: true }).waitFor()
  await page.getByText('Archived epic', { exact: true }).waitFor()
  const epicSelect = page
    .getByRole('complementary', { name: 'Ticket details', exact: true })
    .getByLabel('Epic', { exact: true })
  assert.equal(await epicSelect.inputValue(), String(candidate.id))
  assert.equal(await epicSelect.locator('option:checked').isDisabled(), true)
  await page.getByRole('button', { name: 'Edit ticket', exact: true }).click()
  await page
    .getByLabel('Description', { exact: true })
    .fill('Preserved and editable while its epic is archived.')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page
    .locator('.markdown')
    .getByText('Preserved and editable while its epic is archived.', { exact: true })
    .waitFor()
  await page.getByRole('button', { name: 'Unarchive epic', exact: true }).click()
  await page.getByText('Completed epic', { exact: true }).waitFor()
  await sidebarCandidate.waitFor()
  let epic = await (await page.request.get(`${url}/api/epics/${candidate.id}`)).json()
  assert.equal(epic.completed, true)
  assert.equal(epic.archived, false)

  await patch('epics', candidate.id, { archived: true })
  await page.goto(`${url}/#epics`)
  const archived = page.getByRole('region', { name: 'Archived epics', exact: true })
  const ordinary = page.getByRole('region', { name: 'Active and completed epics', exact: true })
  await archived.getByRole('heading', { name: 'Archive candidate', exact: true }).waitFor()
  assert.equal(
    await ordinary.getByRole('heading', { name: 'Archive candidate', exact: true }).count(),
    0,
  )
  await ordinary.getByRole('heading', { name: 'Completed but visible', exact: true }).waitFor()
  const search = page.getByRole('textbox', { name: 'Find an epic', exact: true })
  await search.fill('no matching archive')
  assert.equal(await archived.locator('.epic-card').count(), 0)
  await search.fill('Archive candidate')
  await archived.getByRole('heading', { name: 'Archive candidate', exact: true }).waitFor()
  await search.fill('')
  await archived.getByRole('button', { name: 'Unarchive Archive candidate', exact: true }).click()
  await ordinary.getByRole('heading', { name: 'Archive candidate', exact: true }).waitFor()
  assert.equal(
    await archived.getByRole('heading', { name: 'Archive candidate', exact: true }).count(),
    0,
  )

  // Unarchive then reopen atomically from the editor, respecting the UI guard.
  await patch('epics', candidate.id, { archived: true })
  await page.goto(`${url}/#epic/${candidate.id}`)
  await page.getByRole('button', { name: 'Unarchive epic', exact: true }).waitFor()
  await editEpic()
  await page.getByRole('checkbox', { name: 'Archived', exact: true }).uncheck()
  await page.getByRole('checkbox', { name: 'Completed', exact: true }).uncheck()
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page.getByRole('button', { name: 'Complete epic', exact: true }).waitFor()
  epic = await (await page.request.get(`${url}/api/epics/${candidate.id}`)).json()
  assert.equal(epic.archived, false)
  assert.equal(epic.completed, false)

  const onlyProject = await create('projects', { name: 'Only archives project' })
  const onlyEpic = await create('epics', {
    project_id: onlyProject.id,
    title: 'Only archived epic',
    completed: true,
    archived: true,
  })
  await page.goto(`${url}/#project/${onlyProject.id}/progress`)
  await page.getByText('All epics are archived.', { exact: true }).waitFor()
  await page
    .getByRole('navigation', { name: 'Project views', exact: true })
    .getByRole('link', { name: 'Board', exact: true })
    .click()
  await page.getByRole('button', { name: 'New ticket', exact: true }).click()
  await page.getByRole('dialog', { name: 'New epic', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${url}/#epics`)
  await page.getByRole('button', { name: 'Unarchive Only archived epic', exact: true }).click()
  await ordinary.getByRole('heading', { name: 'Only archived epic', exact: true }).waitFor()
  assert.equal(
    (await (await page.request.get(`${url}/api/epics/${onlyEpic.id}`)).json()).archived,
    false,
  )
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
})
