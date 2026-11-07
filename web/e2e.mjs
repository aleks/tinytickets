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

  await page.getByRole('button', { name: 'Switch to dark mode' }).click()
  await page.reload()
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark')
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
  await page.getByRole('button', { name: 'Close navigation', exact: true }).click()
  assert.deepEqual(errors, [])
  console.log('PASS: CRUD, dependencies, drag/drop, live updates, concurrent edits, themes, epic completion/reopen, mobile navigation')
} finally {
  await browser?.close()
  if (server.pid && server.exitCode === null && !server.killed) {
    const exited = once(server, 'exit')
    server.kill('SIGTERM')
    await exited
  }
  await rm(dir, { recursive: true, force: true })
}
