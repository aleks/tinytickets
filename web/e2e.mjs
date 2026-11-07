import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Build the binary first. Tests launch an isolated server with an empty database.
const dir = await mkdtemp(join(tmpdir(), 'tinytickets-e2e-'))
const server = spawn(fileURLToPath(new URL('../tinytickets', import.meta.url)), ['--addr', '127.0.0.1:0', '--db', join(dir, 'test.db')], { stdio: ['ignore', 'ignore', 'pipe'] })
let browser
try {
  const url = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server did not start within 10 seconds')), 10000)
    let logs = ''
    server.once('error', err => { clearTimeout(timeout); reject(err) })
    server.once('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited (${code}): ${logs}`)) })
    server.stderr.on('data', chunk => {
      logs += chunk
      const match = logs.match(/url=(http:\/\/[^\s"]+)/)
      if (match) { clearTimeout(timeout); resolve(match[1]) }
    })
  })
  browser = await chromium.launch({ headless: true, channel: 'chromium' })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  page.on('pageerror', err => errors.push(err.message))
  await page.goto(url)
  await page.getByText('No epics yet', { exact: true }).waitFor()

  await page.locator('aside').getByRole('button', { name: 'New project', exact: true }).click()
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('TinyTickets')
  await page.getByRole('button', { name: 'Create project', exact: true }).click()
  await page.locator('aside').getByRole('button', { name: 'New epic', exact: true }).click()
  await page.getByRole('dialog').getByLabel('Title', { exact: true }).fill('First release')
  await page.getByRole('button', { name: 'Create epic', exact: true }).click()
  await page.locator('.nav-epic-project').filter({ hasText: /^TinyTickets$/ }).waitFor()

  // Every displayed entity is a genuine link, including the current page.
  const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb', exact: true })
  await page.locator('.epic-card').click()
  assert.equal(await breadcrumb.getByRole('link', { name: 'First release', exact: true }).getAttribute('href'), '#epic/1')
  assert.equal(await breadcrumb.getByRole('link', { name: 'First release', exact: true }).getAttribute('aria-current'), 'page')
  await breadcrumb.getByRole('link', { name: 'TinyTickets', exact: true }).click()
  await page.getByRole('heading', { name: 'TinyTickets', exact: true }).waitFor()
  assert.equal(new URL(page.url()).hash, '#project/1')
  await breadcrumb.getByRole('link', { name: 'Projects', exact: true }).click()
  await page.getByRole('heading', { name: 'Projects', exact: true }).waitFor()
  await breadcrumb.getByRole('link', { name: 'Workspace', exact: true }).click()
  await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor()
  await page.locator('aside').getByRole('button', { name: /^Epics/ }).click()
  assert.equal(await breadcrumb.getByRole('link', { name: 'Epics', exact: true }).getAttribute('href'), '#epics')
  await breadcrumb.getByRole('link', { name: 'Workspace', exact: true }).click()
  await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor()

  await page.getByRole('button', { name: 'New ticket', exact: true }).click()
  await page.getByLabel('Title', { exact: true }).fill('Build the board')
  await page.getByLabel('Description', { exact: true }).fill('A functional board with live updates.')
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

  await page.locator('.ticket-card').filter({ hasText: 'Build the board' }).dragTo(page.locator('.column-in_progress'))
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

  // Accent preferences apply to the whole interface in both modes.
  const colors = [
    ['Sage', '#3c6957', '#658f75'], ['Slate', '#526c80', '#617e95'],
    ['Lavender', '#786388', '#89729b'], ['Clay', '#916956', '#a17862'],
    ['Sand', '#85713e', '#948049'],
  ]
  const chooseAccent = async label => {
    await page.getByRole('button', { name: 'Choose accent color', exact: true }).click()
    await page.getByRole('group', { name: 'Accent colors', exact: true }).getByRole('button', { name: label, exact: true }).click()
    assert.equal(await page.locator('html').getAttribute('data-accent'), label.toLowerCase())
  }
  const accentValue = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())
  for (const [label, light] of colors) { await chooseAccent(label); assert.equal(await accentValue(), light) }
  await page.getByRole('button', { name: 'Switch to dark mode' }).click()
  for (const [label, , dark] of colors) { await chooseAccent(label); assert.equal(await accentValue(), dark) }
  await chooseAccent('Lavender')
  await page.reload()
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark')
  assert.equal(await page.locator('html').getAttribute('data-accent'), 'lavender')
  await page.getByRole('button', { name: 'Switch to light mode' }).click()
  assert.equal(await page.locator('html').getAttribute('data-accent'), 'lavender')
  assert.equal(await accentValue(), '#786388')
  await page.getByRole('button', { name: 'Choose accent color', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: 'Lavender', exact: true }).getAttribute('aria-pressed'), 'true')
  assert.equal(await page.getByRole('button', { name: 'Lavender', exact: true }).evaluate(e => e === document.activeElement), true)
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('button', { name: 'Choose accent color', exact: true }).getAttribute('aria-expanded'), 'false')
  assert.equal(await page.getByRole('button', { name: 'Choose accent color', exact: true }).evaluate(e => e === document.activeElement), true)
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
  const paletteBounds = await page.getByRole('group', { name: 'Accent colors', exact: true }).boundingBox()
  assert.ok(paletteBounds && paletteBounds.x >= 0 && paletteBounds.x + paletteBounds.width <= 390)
  await page.getByRole('button', { name: 'Clay', exact: true }).click()
  assert.equal(await page.locator('html').getAttribute('data-accent'), 'clay')
  // Click the exposed backdrop, not its center underneath the open sidebar.
  await page.getByRole('button', { name: 'Close navigation', exact: true }).click({ position: { x: 375, y: 100 } })
  // Appearance changes still work if localStorage is blocked by the browser.
  const privatePage = await browser.newPage()
  privatePage.on('pageerror', err => errors.push(err.message))
  await privatePage.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error('Storage unavailable') }
    Storage.prototype.setItem = () => { throw new Error('Storage unavailable') }
  })
  await privatePage.goto(url)
  await privatePage.getByRole('button', { name: 'Choose accent color', exact: true }).click()
  await privatePage.getByRole('button', { name: 'Slate', exact: true }).click()
  assert.equal(await privatePage.locator('html').getAttribute('data-accent'), 'slate')
  await privatePage.close()
  assert.deepEqual(errors, [])
  console.log('PASS: breadcrumbs, CRUD, dependencies, drag/drop, live updates, concurrent edits, themes, persistent accents, epic completion/reopen, mobile navigation, blocked storage')
} finally {
  await browser?.close()
  if (server.pid && server.exitCode === null && !server.killed) {
    const exited = once(server, 'exit')
    server.kill('SIGTERM')
    await exited
  }
  await rm(dir, { recursive: true, force: true })
}
