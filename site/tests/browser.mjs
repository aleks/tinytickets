import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'
import { join } from 'node:path'
import { chromium } from '../../web/node_modules/playwright/index.mjs'
import { expect } from '../../web/node_modules/playwright/test.mjs'
import { siteServer } from '../lib/server.mjs'

const dist = fileURLToPath(new URL('../dist/', import.meta.url))
const manifest = JSON.parse(await readFile(join(dist, 'build.json'), 'utf8'))
const browser = await chromium.launch({ headless: true, channel: 'chromium' })
const errors = [],
  failures = [],
  requests = []
let checks = 0
try {
  for (const prefix of ['/', '/tinytickets/']) {
    const server = siteServer(dist, prefix)
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const origin = `http://127.0.0.1:${server.address().port}`
    try {
      for (const { mobile, theme, width } of [
        { mobile: false, theme: 'light', width: 1440 },
        { mobile: false, theme: 'dark', width: 1440 },
        { mobile: true, theme: 'light', width: 320 },
        { mobile: true, theme: 'dark', width: 390 },
      ]) {
        const context = await browser.newContext({
          viewport: { width, height: mobile ? 844 : 1050 },
          colorScheme: theme,
          reducedMotion: 'reduce',
        })
        const page = await context.newPage()
        page.on('pageerror', (error) => errors.push(error.message))
        page.on('response', (response) => {
          if (response.status() >= 400) failures.push(response.url())
        })
        page.on('request', (request) => requests.push(request.url()))
        try {
          for (const document of manifest.pages) {
            await page.goto(origin + prefix + document.file)
            await expect(
              page.getByRole('heading', { level: 1, name: document.title, exact: true }),
            ).toBeVisible()
            const brand = page.locator('.brand-mark')
            await expect(brand).toHaveAttribute('aria-hidden', 'true')
            assert.match(
              await brand.evaluate((element) => getComputedStyle(element).maskImage),
              /assets\/favicon\.svg/,
            )
            assert.equal(
              await brand.evaluate((element) => getComputedStyle(element).backgroundColor),
              await brand.evaluate((element) => {
                const probe = document.createElement('span')
                probe.style.color = 'var(--accent)'
                element.append(probe)
                const color = getComputedStyle(probe).color
                probe.remove()
                return color
              }),
            )
            const nav = page.getByRole('navigation', {
              name: mobile ? 'Mobile documentation' : 'Documentation',
              exact: true,
            })
            if (mobile) {
              await page.getByText('Browse documentation', { exact: true }).focus()
              await page.keyboard.press('Enter')
            }
            await expect(
              nav.getByRole('link', { name: document.title, exact: true }),
            ).toHaveAttribute('aria-current', 'page')
            if (mobile) await page.getByText('Browse documentation', { exact: true }).click()
            assert.equal(
              await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
              true,
              `Overflow: ${document.file}, ${width}, ${theme}, ${prefix}`,
            )
            await page.getByRole('link', { name: 'Skip to content', exact: true }).focus()
            await page.keyboard.press('Enter')
            await expect(page.locator('main')).toBeFocused()
            const image = page.getByRole('img').first()
            if (await image.count()) {
              await image.scrollIntoViewIfNeeded()
              await expect(image).toBeVisible()
              await expect
                .poll(() =>
                  image.evaluate((element) => element.complete && element.naturalWidth > 0),
                )
                .toBe(true)
            }
            checks++
          }
          await page.goto(origin + prefix + 'index.html')
          const next = page
            .getByRole('navigation', { name: 'Page sequence', exact: true })
            .getByRole('link')
            .last()
          await next.click()
          await expect(page).toHaveURL(origin + prefix + 'start.html')
          checks++
          if (process.env.SITE_SCREENSHOTS && prefix === '/') {
            await mkdir(process.env.SITE_SCREENSHOTS, { recursive: true })
            for (const file of mobile
              ? ['index.html', 'screenshots.html']
              : ['index.html', 'dependencies.html', 'api.html', 'mcp.html', 'agents.html']) {
              await page.goto(origin + prefix + file)
              const images = await page.locator('main img').all()
              for (const image of images) {
                await image.scrollIntoViewIfNeeded()
                await expect
                  .poll(() => image.evaluate((el) => el.complete && el.naturalWidth > 0))
                  .toBe(true)
              }
              await page.evaluate(() => window.scrollTo(0, 0))
              await page.screenshot({
                path: join(
                  process.env.SITE_SCREENSHOTS,
                  `${mobile ? 'mobile' : 'desktop'}-${theme}-${file.replace('.html', '.png')}`,
                ),
                fullPage: true,
                animations: 'disabled',
              })
            }
          }
        } finally {
          await context.close()
        }
      }
    } finally {
      await new Promise((done) => server.close(done))
    }
  }
  assert.deepEqual(errors, [], 'Browser exceptions')
  assert.deepEqual(failures, [], 'Failed asset/page responses')
  assert.ok(
    requests.every((url) => /^http:\/\/127\.0\.0\.1:\d+\//.test(url)),
    'No external services or application API requests',
  )
  assert.ok(
    requests.every((url) => !/\/(?:api(?:\/|$)|mcp(?:\/|$))/.test(new URL(url).pathname)),
    'Documentation must not access application data',
  )
  console.log(
    `PASS: ${checks} page/navigation checks, root and project subpaths, desktop/mobile in both themes, keyboard navigation and image loading`,
  )
} finally {
  await browser.close()
}
