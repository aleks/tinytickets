import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { testExecutionInsights } from './execution.e2e.mjs'
import { testProjectEpicOrdering } from './epic-ordering.e2e.mjs'
import { testEpicArchiving } from './archiving.e2e.mjs'
import { testColumnTimers } from './column-timers.e2e.mjs'
import { testWorkLog } from './work-log.e2e.mjs'
import { testDependencyMap } from './dependency-map.e2e.mjs'

// Build the binary first. Tests launch an isolated server with an empty database.
const dir = await mkdtemp(join(tmpdir(), 'tinytickets-e2e-'))
const server = spawn(
  fileURLToPath(new URL('../tinytickets', import.meta.url)),
  ['--addr', '127.0.0.1:0', '--db', join(dir, 'test.db')],
  { stdio: ['ignore', 'ignore', 'pipe'] },
)
let browser
try {
  const url = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Server did not start within 10 seconds')),
      10000,
    )
    let logs = ''
    server.once('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
    server.once('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`Server exited (${code}): ${logs}`))
    })
    server.stderr.on('data', (chunk) => {
      logs += chunk
      const match = logs.match(/url=(http:\/\/[^\s"]+)/)
      if (match) {
        clearTimeout(timeout)
        resolve(match[1])
      }
    })
  })
  browser = await chromium.launch({ headless: true, channel: 'chromium' })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  page.on('pageerror', (err) => errors.push(err.message))
  await page.goto(url)
  await page.getByText('No epics yet', { exact: true }).waitFor()

  await page.locator('aside').getByRole('button', { name: 'New project', exact: true }).click()
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('TinyTickets')
  await page.getByRole('button', { name: 'Create project', exact: true }).click()
  await page.locator('aside').getByRole('button', { name: 'New epic', exact: true }).click()
  await page.getByRole('dialog').getByLabel('Title', { exact: true }).fill('First release')
  await page.getByRole('button', { name: 'Create epic', exact: true }).click()
  await page
    .locator('.nav-epic-project')
    .filter({ hasText: /^TinyTickets$/ })
    .waitFor()

  // Every displayed entity is a genuine link, including the current page.
  const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb', exact: true })
  await page.locator('.epic-card').click()
  assert.equal(
    await breadcrumb.getByRole('link', { name: 'First release', exact: true }).getAttribute('href'),
    '#epic/1',
  )
  assert.equal(
    await breadcrumb
      .getByRole('link', { name: 'First release', exact: true })
      .getAttribute('aria-current'),
    'page',
  )
  await breadcrumb.getByRole('link', { name: 'TinyTickets', exact: true }).click()
  await page.getByRole('heading', { name: 'TinyTickets', exact: true }).waitFor()
  assert.equal(new URL(page.url()).hash, '#project/1')
  await breadcrumb.getByRole('link', { name: 'Projects', exact: true }).click()
  await page.getByRole('heading', { name: 'Projects', exact: true }).waitFor()
  await breadcrumb.getByRole('link', { name: 'Workspace', exact: true }).click()
  await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor()
  await page
    .locator('aside')
    .getByRole('button', { name: /^Epics/ })
    .click()
  assert.equal(
    await breadcrumb.getByRole('link', { name: 'Epics', exact: true }).getAttribute('href'),
    '#epics',
  )
  await breadcrumb.getByRole('link', { name: 'Workspace', exact: true }).click()
  await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor()

  await page.getByRole('button', { name: 'New ticket', exact: true }).click()
  await page.getByLabel('Title', { exact: true }).fill('Build the board')
  await page
    .getByLabel('Description', { exact: true })
    .fill('A functional board with live updates.')
  await page.getByRole('button', { name: 'Create ticket', exact: true }).click()
  await page.getByRole('button', { name: 'New ticket', exact: true }).click()
  await page.getByLabel('Title', { exact: true }).fill('Review the release')
  await page.getByRole('button', { name: 'Create ticket', exact: true }).click()

  await page.locator('.ticket-card').filter({ hasText: 'Review the release' }).click()
  await page.getByLabel('Linked ticket', { exact: true }).selectOption('1')
  await page.getByRole('button', { name: 'Link', exact: true }).click()
  await page.locator('.dependency-row').waitFor()
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  assert.equal(await page.locator('.blocked-badge').count(), 1)

  await page
    .locator('.ticket-card')
    .filter({ hasText: 'Build the board' })
    .dragTo(page.locator('.column-in_progress'))
  await page.locator('.column-in_progress .ticket-card').waitFor()
  const moved = await page.request.get(`${url}/api/tickets/1`)
  assert.equal((await moved.json()).status, 'in_progress')
  await page.request.patch(`${url}/api/tickets/1`, { data: { status: 'ready_for_review' } })
  await page.locator('.column-ready_for_review .ticket-card').waitFor()

  // Editing a title must not undo an agent's concurrent status change.
  await page.locator('.ticket-card').filter({ hasText: 'Build the board' }).click()
  await page.getByLabel('Title', { exact: true }).fill('Board is ready')
  await page.request.patch(`${url}/api/tickets/1`, { data: { status: 'done' } })
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page.locator('.column-done .ticket-card').filter({ hasText: 'Board is ready' }).waitFor()
  assert.equal(await page.locator('.blocked-badge').count(), 0)

  // Full ticket pages: modal title link, safe Markdown/Mermaid, edits and links.
  const description = [
    '## Delivery plan',
    '',
    '**Ship carefully** with `go test`.',
    '',
    '- [x] Build the board',
    '- [ ] Review the release',
    '',
    '| Step | State |',
    '| --- | --- |',
    '| Board | Ready |',
    '',
    '[Epic](#epic/1)',
    '[Unsafe](javascript:alert%281%29)',
    '<img src=x onerror="window.ticketXSS=true">',
    '',
    '```go',
    'fmt.Println("ready")',
    '```',
    '',
    '```mermaid',
    '%%{init: {"securityLevel":"loose","themeCSS":"body { display: none }"}}%%',
    'flowchart LR',
    '  Start --> Review',
    '  click Start "https://example.com"',
    '```',
    '',
    '```mermaid',
    'sequenceDiagram',
    '  Alice->>Bob: Review the board',
    '```',
  ].join('\n')
  await page.request.patch(`${url}/api/tickets/1`, { data: { description } })
  await page.locator('.ticket-card').filter({ hasText: 'Board is ready' }).click()
  const fullPageLink = page.getByRole('dialog').getByRole('link', { name: /Board is ready/ })
  assert.equal(await fullPageLink.getAttribute('href'), '#ticket/1')
  await page.getByLabel('Title', { exact: true }).fill('Unsaved title')
  page.once('dialog', (dialog) => dialog.dismiss())
  await fullPageLink.click()
  assert.equal(await page.getByRole('dialog').count(), 1)
  page.once('dialog', (dialog) => dialog.accept())
  await fullPageLink.click()
  await page.getByRole('heading', { name: 'Board is ready', exact: true }).waitFor()
  assert.equal(new URL(page.url()).hash, '#ticket/1')
  assert.equal(await page.getByRole('dialog').count(), 0)
  await page.locator('.markdown strong').filter({ hasText: 'Ship carefully' }).waitFor()
  assert.equal(await page.locator('.markdown table').count(), 1)
  assert.equal(await page.locator('.markdown input[type=checkbox]').count(), 2)
  assert.equal(
    await page.locator('.markdown code.language-go').textContent(),
    'fmt.Println("ready")\n',
  )
  await page.locator('.mermaid-diagram svg').nth(1).waitFor()
  assert.equal(await page.locator('.mermaid-diagram svg').count(), 2)
  assert.match(await page.locator('.mermaid-diagram svg').first().textContent(), /Start/)
  assert.match(await page.locator('.mermaid-diagram svg').nth(1).textContent(), /Alice/)
  assert.equal(
    await page
      .locator('.mermaid-diagram svg a, .mermaid-diagram svg script, .markdown img')
      .count(),
    0,
  )
  assert.ok(
    !(
      (await page.getByRole('link', { name: 'Unsafe', exact: true }).getAttribute('href')) || ''
    ).startsWith('javascript:'),
  )
  assert.equal(await page.evaluate(() => window.ticketXSS), undefined)
  assert.notEqual(await page.locator('body').evaluate((el) => getComputedStyle(el).display), 'none')
  assert.equal(
    await breadcrumb.getByRole('link', { name: 'TT-1', exact: true }).getAttribute('aria-current'),
    'page',
  )
  assert.equal(
    await breadcrumb.getByRole('link', { name: 'First release', exact: true }).getAttribute('href'),
    '#epic/1',
  )
  const details = page.getByRole('complementary', { name: 'Ticket details', exact: true })
  await details.getByLabel('Status', { exact: true }).selectOption('in_progress')
  await page.waitForFunction(
    () =>
      document.querySelector('.ticket-details select')?.value === 'in_progress' &&
      !document.querySelector('.ticket-details select')?.disabled,
  )
  assert.equal(
    (await (await page.request.get(`${url}/api/tickets/1`)).json()).status,
    'in_progress',
  )
  await details.getByLabel('Status', { exact: true }).selectOption('done')
  const anotherProject = await (
    await page.request.post(`${url}/api/projects`, { data: { name: 'Another project' } })
  ).json()
  const anotherEpic = await (
    await page.request.post(`${url}/api/epics`, {
      data: { project_id: anotherProject.id, title: 'Another epic' },
    })
  ).json()
  await details.getByLabel('Epic', { exact: true }).selectOption(String(anotherEpic.id))
  await breadcrumb.getByRole('link', { name: 'Another project', exact: true }).waitFor()
  await breadcrumb.getByRole('link', { name: 'Another epic', exact: true }).waitFor()
  await details.getByLabel('Epic', { exact: true }).selectOption('1')
  await breadcrumb.getByRole('link', { name: 'First release', exact: true }).waitFor()
  await page.request.delete(`${url}/api/epics/${anotherEpic.id}`)
  await page.request.delete(`${url}/api/projects/${anotherProject.id}`)
  await page.getByRole('button', { name: 'Edit ticket', exact: true }).click()
  await page
    .getByLabel('Description', { exact: true })
    .fill(description + '\n\nEdited from the ticket page.')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page
    .locator('.markdown')
    .getByText('Edited from the ticket page.', { exact: true })
    .waitFor()
  await page.reload()
  await page.getByRole('heading', { name: 'Board is ready', exact: true }).waitFor()
  await page.locator('.mermaid-diagram svg').nth(1).waitFor()
  // Diagrams rerender when theme or accent changes, not just on page reload.
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
  await details.getByRole('link', { name: /Review the release/ }).click()
  await page.getByRole('heading', { name: 'Review the release', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Add a description…', exact: true }).click()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.goBack()
  await page.getByRole('heading', { name: 'Board is ready', exact: true }).waitFor()
  // Invalid diagram syntax must not break the page, and later updates recover.
  await page.request.patch(`${url}/api/tickets/1`, {
    data: { description: '```mermaid\nnot a valid diagram\n```' },
  })
  await page
    .getByText('Unable to render Mermaid diagram. Check its syntax or size.', { exact: true })
    .waitFor()
  await page.request.patch(`${url}/api/tickets/1`, { data: { description } })
  await page.locator('.mermaid-diagram svg').nth(1).waitFor()
  // Completed epics remain addressable through direct ticket links.
  await page.request.patch(`${url}/api/epics/1`, { data: { completed: true } })
  await page.getByText('Completed epic', { exact: true }).waitFor()
  await page.reload()
  await page.getByRole('heading', { name: 'Board is ready', exact: true }).waitFor()
  await page.request.patch(`${url}/api/epics/1`, { data: { completed: false } })
  await page.goto(`${url}/#ticket/999999`)
  await page.getByRole('heading', { name: 'Not found', exact: true }).first().waitFor()
  await breadcrumb.getByRole('link', { name: 'Workspace', exact: true }).click()
  await page.locator('.ticket-card').first().waitFor()

  // Accent preferences apply to the whole interface in both modes.
  const colors = [
    ['Sage', '#3c6957', '#658f75'],
    ['Slate', '#526c80', '#617e95'],
    ['Lavender', '#786388', '#89729b'],
    ['Clay', '#916956', '#a17862'],
    ['Sand', '#85713e', '#948049'],
  ]
  const chooseAccent = async (label) => {
    await page.getByRole('button', { name: 'Choose accent color', exact: true }).click()
    await page
      .getByRole('group', { name: 'Accent colors', exact: true })
      .getByRole('button', { name: label, exact: true })
      .click()
    assert.equal(await page.locator('html').getAttribute('data-accent'), label.toLowerCase())
  }
  const accentValue = () =>
    page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    )
  const rgb = (hex) =>
    `rgb(${hex
      .slice(1)
      .match(/../g)
      .map((channel) => parseInt(channel, 16))
      .join(', ')})`
  const checkBackground = async (selector, hex) => {
    // Board columns transition between palettes; assert the final rendered color.
    await page.waitForFunction(
      ({ selector, expected }) => {
        const el = document.querySelector(selector)
        return el && getComputedStyle(el).backgroundColor === expected
      },
      { selector, expected: rgb(hex) },
    )
  }
  const darkSurfaces = {
    Sage: ['#171a19', '#202422', '#131614', '#1c201e', '#1a1e1b', '#2d342f'],
    Slate: ['#171a1d', '#20252a', '#131619', '#1c2024', '#1a1f23', '#2d353d'],
    Lavender: ['#1b181e', '#26212b', '#161319', '#211d26', '#201b24', '#37303f'],
    Clay: ['#1e1917', '#2b2320', '#191513', '#261f1c', '#241e1a', '#3f332d'],
    Sand: ['#1d1b16', '#29261e', '#181610', '#242119', '#232016', '#3d3729'],
  }
  for (const [label, light] of colors) {
    await chooseAccent(label)
    assert.equal(await accentValue(), light)
  }
  await page.getByRole('button', { name: 'Switch to dark mode' }).click()
  for (const [label, , dark] of colors) {
    await chooseAccent(label)
    assert.equal(await accentValue(), dark)
    const [background, surface, sidebar, column, input, border] = darkSurfaces[label]
    await checkBackground('html', background)
    await checkBackground('.sidebar', sidebar)
    await checkBackground('.ticket-card', surface)
    await checkBackground('.column', column)
    assert.equal(
      await page
        .locator('.ticket-card')
        .first()
        .evaluate((el) => getComputedStyle(el).borderTopColor),
      rgb(border),
    )
    await page.getByRole('button', { name: 'New ticket', exact: true }).click()
    await checkBackground('.modal', surface)
    await checkBackground('.field-label input', input)
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  }
  await chooseAccent('Lavender')
  await page.reload()
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark')
  assert.equal(await page.locator('html').getAttribute('data-accent'), 'lavender')
  await checkBackground('html', darkSurfaces.Lavender[0])
  await page.getByRole('button', { name: 'Switch to light mode' }).click()
  assert.equal(await page.locator('html').getAttribute('data-accent'), 'lavender')
  assert.equal(await accentValue(), '#786388')
  await checkBackground('html', '#fafaf9')
  await checkBackground('.sidebar', '#f3f3f1')
  await checkBackground('.ticket-card', '#ffffff')
  await page.getByRole('button', { name: 'Choose accent color', exact: true }).click()
  assert.equal(
    await page.getByRole('button', { name: 'Lavender', exact: true }).getAttribute('aria-pressed'),
    'true',
  )
  assert.equal(
    await page
      .getByRole('button', { name: 'Lavender', exact: true })
      .evaluate((e) => e === document.activeElement),
    true,
  )
  await page.keyboard.press('Escape')
  assert.equal(
    await page
      .getByRole('button', { name: 'Choose accent color', exact: true })
      .getAttribute('aria-expanded'),
    'false',
  )
  assert.equal(
    await page
      .getByRole('button', { name: 'Choose accent color', exact: true })
      .evaluate((e) => e === document.activeElement),
    true,
  )
  await page.getByRole('button', { name: 'Choose accent color', exact: true }).click()
  await page.getByRole('heading', { name: 'Overview', exact: true }).click()
  assert.equal(await page.getByRole('group', { name: 'Accent colors', exact: true }).count(), 0)
  // Ignore invalid persisted values and retain the original default palette.
  await page.evaluate(() => localStorage.setItem('accent', 'unknown-color'))
  await page.reload()
  assert.equal(await page.locator('html').getAttribute('data-accent'), 'sage')
  await page.locator('.epic-card').click()
  await page.getByRole('button', { name: 'Complete epic', exact: true }).click()
  await page.getByRole('button', { name: /Overview/ }).click()
  await page.getByText('All epics completed', { exact: true }).waitFor()
  assert.equal(await page.locator('.ticket-card').count(), 0)
  await page.locator('aside').getByRole('button', { name: 'Epics', exact: false }).first().click()
  await page.locator('.epic-card').click()
  await page.getByRole('button', { name: 'Reopen epic', exact: true }).click()
  await page.getByRole('button', { name: /Overview/ }).click()
  await page.locator('.epic-card').waitFor()

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
  await page.locator('.sidebar.open').waitFor()
  await page.getByRole('button', { name: 'Choose accent color', exact: true }).click()
  const paletteBounds = await page
    .getByRole('group', { name: 'Accent colors', exact: true })
    .boundingBox()
  assert.ok(paletteBounds && paletteBounds.x >= 0 && paletteBounds.x + paletteBounds.width <= 390)
  await page.getByRole('button', { name: 'Clay', exact: true }).click()
  assert.equal(await page.locator('html').getAttribute('data-accent'), 'clay')
  // Click the exposed backdrop, not its center underneath the open sidebar.
  await page
    .getByRole('button', { name: 'Close navigation', exact: true })
    .click({ position: { x: 375, y: 100 } })
  await page.goto(`${url}/#ticket/1`)
  await page.getByRole('heading', { name: 'Board is ready', exact: true }).waitFor()
  await page.locator('.mermaid-diagram svg').nth(1).waitFor()
  await page.getByRole('complementary', { name: 'Ticket details', exact: true }).waitFor()
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  )
  // Ticket deletion is reflected in an already open full page.
  await page.request.delete(`${url}/api/tickets/1`)
  await page.getByRole('heading', { name: 'Not found', exact: true }).first().waitFor()
  await page.setViewportSize({ width: 1440, height: 1000 })
  await testExecutionInsights(page, url)
  await testProjectEpicOrdering(page, url)
  await testEpicArchiving(page, url)
  await testWorkLog(page, url)
  await testDependencyMap(page, url)
  await testColumnTimers(page, url)
  // Appearance changes still work if localStorage is blocked by the browser.
  const privatePage = await browser.newPage()
  privatePage.on('pageerror', (err) => errors.push(err.message))
  await privatePage.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error('Storage unavailable')
    }
    Storage.prototype.setItem = () => {
      throw new Error('Storage unavailable')
    }
  })
  await privatePage.goto(url)
  await privatePage.getByRole('button', { name: 'Choose accent color', exact: true }).click()
  await privatePage.getByRole('button', { name: 'Slate', exact: true }).click()
  assert.equal(await privatePage.locator('html').getAttribute('data-accent'), 'slate')
  await privatePage.close()
  assert.deepEqual(errors, [])
  console.log(
    'PASS: interactive dependency maps, ordered work logs/review handoffs, live current-column timers, epic archiving, project ordering, execution insights, full ticket pages, safe Markdown/Mermaid, CRUD, live updates, themes, mobile layout, blocked storage',
  )
} finally {
  await browser?.close()
  if (server.pid && server.exitCode === null && !server.killed) {
    const exited = once(server, 'exit')
    server.kill('SIGTERM')
    await exited
  }
  await rm(dir, { recursive: true, force: true })
}
