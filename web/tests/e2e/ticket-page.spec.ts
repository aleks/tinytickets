import { test, expect } from './fixtures'
import { api } from './helpers/api'
import { seedBoard } from './helpers/seeds'

test('modal navigation guards unsaved edits and renders safe Markdown and Mermaid', async ({
  page,
  serverURL: url,
}) => {
  const { ticket, epic } = await seedBoard(page, url)
  await page.goto(url)
  await page.locator('.ticket-card').filter({ hasText: ticket.title }).click()
  const fullPageLink = page.getByRole('dialog').getByRole('link', { name: /Board is ready/ })
  await expect(fullPageLink).toHaveAttribute('href', `#ticket/${ticket.id}`)
  await page.getByLabel('Title', { exact: true }).fill('Unsaved title')
  page.once('dialog', (dialog) => dialog.dismiss())
  await fullPageLink.click()
  await expect(page.getByRole('dialog')).toHaveCount(1)
  page.once('dialog', (dialog) => dialog.accept())
  await fullPageLink.click()
  await expect(page.getByRole('heading', { name: ticket.title, exact: true })).toBeVisible()
  await expect(page).toHaveURL(`${url}/#ticket/${ticket.id}`)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.markdown strong').filter({ hasText: 'Ship carefully' })).toBeVisible()
  await expect(page.locator('.markdown table')).toHaveCount(1)
  await expect(page.locator('.markdown input[type=checkbox]')).toHaveCount(2)
  expect(await page.locator('.markdown code.language-go').textContent()).toBe(
    'fmt.Println("ready")\n',
  )
  await expect(page.locator('.mermaid-diagram svg')).toHaveCount(2)
  await expect(page.locator('.mermaid-diagram svg').nth(1)).toBeVisible()
  await expect(page.locator('.mermaid-diagram svg').first()).toContainText('Start')
  await expect(page.locator('.mermaid-diagram svg').nth(1)).toContainText('Alice')
  await expect(
    page.locator('.mermaid-diagram svg a, .mermaid-diagram svg script, .markdown img'),
  ).toHaveCount(0)
  expect(
    (
      (await page.getByRole('link', { name: 'Unsafe', exact: true }).getAttribute('href')) || ''
    ).startsWith('javascript:'),
  ).toBe(false)
  expect(
    await page.evaluate(() => (window as Window & { ticketXSS?: boolean }).ticketXSS),
  ).toBeUndefined()
  expect(await page.locator('body').evaluate((el) => getComputedStyle(el).display)).not.toBe('none')
  const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb', exact: true })
  await expect(
    breadcrumb.getByRole('link', { name: `TT-${ticket.id}`, exact: true }),
  ).toHaveAttribute('aria-current', 'page')
  await expect(breadcrumb.getByRole('link', { name: epic.title, exact: true })).toHaveAttribute(
    'href',
    `#epic/${epic.id}`,
  )
})

test('ticket details persist status, reassignment, edits, dependency navigation and history', async ({
  page,
  serverURL: url,
}) => {
  const { ticket, epic, description, review } = await seedBoard(page, url)
  const { create } = api(page.request, url)
  await page.goto(`${url}/#ticket/${ticket.id}`)
  const details = page.getByRole('complementary', { name: 'Ticket details', exact: true })
  const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb', exact: true })
  await details.getByLabel('Status', { exact: true }).selectOption('in_progress')
  await page.waitForFunction(() => {
    const select = document.querySelector<HTMLSelectElement>('.ticket-details select')
    return select?.value === 'in_progress' && !select.disabled
  })
  expect((await (await page.request.get(`${url}/api/tickets/${ticket.id}`)).json()).status).toBe(
    'in_progress',
  )
  await details.getByLabel('Status', { exact: true }).selectOption('done')
  const anotherProject = await create('projects', { name: 'Another project' })
  const anotherEpic = await create('epics', {
    project_id: anotherProject.id,
    title: 'Another epic',
  })
  await details.getByLabel('Epic', { exact: true }).selectOption(String(anotherEpic.id))
  await expect(
    breadcrumb.getByRole('link', { name: anotherProject.name, exact: true }),
  ).toBeVisible()
  await expect(breadcrumb.getByRole('link', { name: anotherEpic.title, exact: true })).toBeVisible()
  await details.getByLabel('Epic', { exact: true }).selectOption(String(epic.id))
  await expect(breadcrumb.getByRole('link', { name: epic.title, exact: true })).toBeVisible()
  expect((await page.request.delete(`${url}/api/epics/${anotherEpic.id}`)).ok()).toBe(true)
  expect((await page.request.delete(`${url}/api/projects/${anotherProject.id}`)).ok()).toBe(true)
  await page.getByRole('button', { name: 'Edit ticket', exact: true }).click()
  await page
    .getByLabel('Description', { exact: true })
    .fill(description + '\n\nEdited from the ticket page.')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(
    page.locator('.markdown').getByText('Edited from the ticket page.', { exact: true }),
  ).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: ticket.title, exact: true })).toBeVisible()
  await expect(page.locator('.mermaid-diagram svg')).toHaveCount(2)
  await expect(page.locator('.mermaid-diagram svg').nth(1)).toBeVisible()
  await details.getByRole('link', { name: /Review the release/ }).click()
  await expect(page.getByRole('heading', { name: review.title, exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Add a description…', exact: true }).click()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.goBack()
  await expect(page.getByRole('heading', { name: ticket.title, exact: true })).toBeVisible()
})

test('Mermaid rerenders on theme and accent changes and recovers from live invalid syntax', async ({
  page,
  serverURL: url,
}) => {
  const { ticket, description } = await seedBoard(page, url)
  const { patch } = api(page.request, url)
  await page.goto(`${url}/#ticket/${ticket.id}`)
  await expect(page.locator('.mermaid-diagram svg')).toHaveCount(2)
  await expect(page.locator('.mermaid-diagram svg').nth(1)).toBeVisible()
  const diagramID = await page.locator('.mermaid-diagram svg').first().getAttribute('id')
  await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click()
  await page.waitForFunction((id) => {
    const svg = document.querySelector('.mermaid-diagram svg')
    return svg && svg.id !== id
  }, diagramID)
  await page.getByRole('button', { name: 'Choose accent color', exact: true }).click()
  await page.getByRole('button', { name: 'Lavender', exact: true }).click()
  await page.waitForFunction(() => {
    const node = document.querySelector('.mermaid-diagram svg .node rect')
    return node && getComputedStyle(node).fill === 'rgb(56, 47, 64)'
  })
  await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click()
  await patch('tickets', ticket.id, { description: '```mermaid\nnot a valid diagram\n```' })
  await expect(
    page.getByText('Unable to render Mermaid diagram. Check its syntax or size.', { exact: true }),
  ).toBeVisible()
  await patch('tickets', ticket.id, { description })
  await expect(page.locator('.mermaid-diagram svg')).toHaveCount(2)
  await expect(page.locator('.mermaid-diagram svg').nth(1)).toBeVisible()
})

test('completed epic tickets remain addressable and missing or remotely deleted tickets recover', async ({
  page,
  serverURL: url,
}) => {
  const { ticket, epic } = await seedBoard(page, url)
  const { patch } = api(page.request, url)
  await page.goto(`${url}/#ticket/${ticket.id}`)
  await expect(page.getByRole('heading', { name: ticket.title, exact: true })).toBeVisible()
  await patch('epics', epic.id, { completed: true })
  await expect(page.getByText('Completed epic', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: ticket.title, exact: true })).toBeVisible()
  await patch('epics', epic.id, { completed: false })
  await page.goto(`${url}/#ticket/999999`)
  await expect(page.getByRole('heading', { name: 'Not found', exact: true }).first()).toBeVisible()
  await page
    .getByRole('navigation', { name: 'Breadcrumb', exact: true })
    .getByRole('link', { name: 'Workspace', exact: true })
    .click()
  await expect(page.locator('.ticket-card').first()).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${url}/#ticket/${ticket.id}`)
  await expect(page.getByRole('heading', { name: ticket.title, exact: true })).toBeVisible()
  expect((await page.request.delete(`${url}/api/tickets/${ticket.id}`)).ok()).toBe(true)
  await expect(page.getByRole('heading', { name: 'Not found', exact: true }).first()).toBeVisible()
})
