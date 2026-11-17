import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, mkdtemp, mkdir, cp, writeFile, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, resolve, dirname, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { build } from '../build.mjs'
import { siteServer } from '../lib/server.mjs'

const site = fileURLToPath(new URL('../', import.meta.url))
const dist = join(site, 'dist')
const manifest = JSON.parse(await readFile(join(dist, 'build.json'), 'utf8'))
const pages = await Promise.all(
  manifest.pages.map(async (page) => ({
    ...page,
    html: await readFile(join(dist, page.file), 'utf8'),
  })),
)
const ids = (html) => [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1])

test('build output contains eleven complete documents and all nineteen real screenshots', async () => {
  assert.equal(pages.length, 11)
  assert.equal(manifest.screenshots.length, 19)
  const files = (await readdir(dist)).filter((file) => file.endsWith('.html')).sort()
  assert.deepEqual(files, manifest.pages.map((page) => page.file).sort())
  for (const { file, html } of pages) {
    assert.match(html, /^<!doctype html>/i, file)
    assert.match(html, /<html lang="en">/, file)
    assert.equal([...html.matchAll(/<h1[ >]/g)].length, 1, file)
    assert.match(html, /<meta name="description" content="[^"]+">/, file)
    assert.match(html, /<main id="main" tabindex="-1">/, file)
    assert.equal(ids(html).length, new Set(ids(html)).size, `Duplicate IDs in ${file}`)
    assert.doesNotMatch(html, /<script\b|\son\w+=/i, 'No client-side JavaScript is needed')
    assert.doesNotMatch(
      html,
      /(?:src|href)="\/[^/]/,
      'Assets and navigation must support project subpaths',
    )
  }
  for (const file of manifest.screenshots) {
    assert.deepEqual(
      await readFile(join(dist, 'assets', 'screenshots', file)),
      await readFile(join(site, 'screenshots', file)),
    )
  }
})

test('Connect has separate API and MCP references alongside the agent workflow', () => {
  const api = pages.find((page) => page.file === 'api.html')
  const mcp = pages.find((page) => page.file === 'mcp.html')
  assert.ok(api)
  assert.ok(mcp)
  for (const { html } of pages) {
    assert.match(html, /href="api.html"/)
    assert.match(html, /href="mcp.html"/)
    assert.match(html, /href="agents.html"/)
  }
  for (const route of [
    '/api/state',
    '/api/tickets/claim-next',
    '/api/tickets/{id}/review-handoff',
    '/api/events',
    '/api/{kind}/{id}/deletion-preview',
  ]) {
    assert.ok(api.html.includes(route), route)
  }
  for (const tool of [
    'get_workspace',
    'claim_ticket',
    'claim_next_ticket',
    'get_ready_tickets',
    'get_ticket_work_log',
    'add_work_log',
    'create_review_handoff',
    'get_project_execution',
    'get_deletion_preview',
    'unlink_tickets',
  ]) {
    assert.ok(mcp.html.includes(`<code>${tool}</code>`), tool)
  }
  for (const { html } of [api, mcp]) {
    assert.match(html, /confirmation_token/)
    assert.match(html, /no built-in authentication/)
    assert.match(html, /href="safety.html"/)
    assert.match(html, /<pre><code>/)
  }
  assert.match(mcp.html, /--mcp-stdio/)
  assert.match(mcp.html, /Streamable HTTP/)
})

test('every local link, image and section target resolves inside the publish directory', async () => {
  let checked = 0
  for (const { file, html } of pages) {
    for (const [, raw] of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
      if (raw.startsWith('https://')) {
        assert.equal(new URL(raw).hostname, 'github.com')
        continue
      }
      assert.doesNotMatch(raw, /^(?:[a-z]+:|\/\/)/i, `Unexpected URL: ${raw}`)
      const [path, fragment] = raw.split('#')
      const target = resolve(dirname(join(dist, file)), path || file)
      assert.ok(target.startsWith(dist + sep), raw)
      const content = await readFile(target)
      if (fragment) assert.ok(ids(content.toString()).includes(fragment), `${file}: ${raw}`)
      checked++
    }
  }
  assert.ok(checked > 200)
})

test('documents have current navigation, labeled images and table headers', () => {
  for (const { file, html } of pages) {
    assert.equal([...html.matchAll(/aria-current="page"/g)].length, 2, file)
    assert.match(html, /href="#main">Skip to content/, file)
    for (const [image] of html.matchAll(/<img\b[^>]*>/g)) {
      assert.match(image, /alt="[^"]{3,}"/)
      assert.match(image, /width="[1-9][0-9]*"/)
      assert.match(image, /height="[1-9][0-9]*"/)
      assert.match(image, /loading="lazy"/)
    }
    for (const [table] of html.matchAll(/<table>[\s\S]*?<\/table>/g)) {
      assert.match(table, /<caption>/)
      assert.match(table, /<th scope="col">/)
    }
  }
})

test('Pages workflow publishes only generated docs and restricts deployment to main', async () => {
  const workflow = await readFile(
    join(site, '..', '.github', 'workflows', 'documentation.yml'),
    'utf8',
  )
  assert.match(workflow, /branches: \[main\]/)
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /run: npm --prefix site run check/)
  assert.match(workflow, /path: site\/dist\s/)
  assert.match(workflow, /if: github.ref == 'refs\/heads\/main'/)
  assert.match(workflow, /needs: build/)
  assert.match(workflow, /name: github-pages/)
  assert.match(workflow, /pages: write/)
  assert.match(workflow, /id-token: write/)
  const actions = [...workflow.matchAll(/uses: ([^\s]+)/g)].map((match) => match[1])
  assert.equal(actions.length, 5)
  for (const action of actions) assert.match(action, /^actions\/[a-z-]+@[0-9a-f]{40}$/)
  assert.doesNotMatch(workflow, /secrets\.|enablement: true/)
  assert.doesNotMatch(await readFile(join(dist, 'index.html'), 'utf8'), /(?:src|href)="\//)
  await assert.rejects(readFile(join(dist, 'CNAME')), { code: 'ENOENT' })
})

test('documentation uses the canonical Paper Trail brand and favicon', async () => {
  assert.deepEqual(
    await readFile(join(dist, 'assets/favicon.svg')),
    await readFile(join(site, '../web/public/paper-trail.svg')),
  )
  for (const page of manifest.pages) {
    const html = await readFile(join(dist, page.file), 'utf8')
    assert.match(html, /<span class="brand-mark" aria-hidden="true"><\/span>/)
    assert.match(html, /rel="icon" href="assets\/favicon.svg"/)
    assert.doesNotMatch(html, /viewBox="0 0 32 32"/)
  }
})

test('builds are deterministic and need no application server or dependencies', async () => {
  const digest = async () => {
    const hash = createHash('sha256')
    for (const file of [
      ...manifest.pages.map((p) => p.file),
      'assets/style.css',
      'assets/favicon.svg',
      'build.json',
    ])
      hash.update(await readFile(join(dist, file)))
    return hash.digest('hex')
  }
  const before = await digest()
  await build()
  assert.equal(await digest(), before)
  const pkg = JSON.parse(await readFile(join(site, 'package.json'), 'utf8'))
  assert.equal(pkg.dependencies, undefined)
  assert.equal(pkg.devDependencies, undefined)
})

test('builder refuses to replace an output directory that it does not own', async (t) => {
  const temp = await mkdtemp(join(tmpdir(), 'tinytickets-docs-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  await cp(join(site, 'build.mjs'), join(temp, 'build.mjs'))
  await cp(join(site, 'content.mjs'), join(temp, 'content.mjs'))
  await mkdir(join(temp, 'dist'))
  await writeFile(join(temp, 'dist', 'keep.txt'), 'User file')
  const result = spawnSync(process.execPath, [join(temp, 'build.mjs')], { encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /without the generated-output marker/)
  assert.equal(await readFile(join(temp, 'dist', 'keep.txt'), 'utf8'), 'User file')
})

test('preview server supports root and project subpaths without an API', async (t) => {
  for (const prefix of ['/', '/tinytickets/']) {
    const server = siteServer(dist, prefix)
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    t.after(() => new Promise((done) => server.close(done)))
    const origin = `http://127.0.0.1:${server.address().port}`
    const response = await fetch(origin + prefix)
    assert.equal(response.status, 200)
    assert.match(await response.text(), /Overview · TinyTickets/)
    const css = await fetch(origin + prefix + 'assets/style.css')
    assert.match(css.headers.get('content-type'), /text\/css/)
    assert.equal(css.headers.get('x-content-type-options'), 'nosniff')
    const head = await fetch(origin + prefix + 'start.html', { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(await head.text(), '')
    assert.equal((await fetch(origin + prefix, { method: 'POST' })).status, 405)
    assert.equal((await fetch(origin + prefix + 'api/state')).status, 404)
    assert.equal((await fetch(origin + prefix + '.tinytickets-docs-generated')).status, 404)
    assert.equal((await fetch(origin + prefix + 'missing.html')).status, 404)
    if (prefix !== '/') {
      assert.equal((await fetch(origin + '/index.html')).status, 404)
      assert.equal((await fetch(origin + '/tinytickets', { redirect: 'manual' })).status, 301)
    }
  }
})
