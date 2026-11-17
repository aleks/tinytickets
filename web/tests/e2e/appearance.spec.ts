import { test, expect } from './fixtures'
import { seedBoard } from './helpers/seeds'

test('all accent palettes apply to interface surfaces and persist with accessible controls', async ({
  page,
  serverURL: url,
}) => {
  await seedBoard(page, url)
  await page.goto(url)
  await expect(page.locator('.ticket-card').first()).toBeVisible()
  const colors = [
    ['Sage', '#3c6957', '#658f75'],
    ['Slate', '#526c80', '#617e95'],
    ['Lavender', '#786388', '#89729b'],
    ['Clay', '#916956', '#a17862'],
    ['Sand', '#85713e', '#948049'],
  ] as const
  const chooseAccent = async (label: string) => {
    await page.getByRole('button', { name: 'Choose accent color', exact: true }).click()
    await page
      .getByRole('group', { name: 'Accent colors', exact: true })
      .getByRole('button', { name: label, exact: true })
      .click()
    await expect(page.locator('html')).toHaveAttribute('data-accent', label.toLowerCase())
  }
  const accentValue = () =>
    page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    )
  const brand = page.locator('.brand-mark')
  await expect(brand).toHaveAttribute('aria-hidden', 'true')
  await expect(brand).toHaveCSS('transform', 'none')
  expect(await brand.evaluate((element) => getComputedStyle(element).maskImage)).toContain(
    'paper-trail.svg',
  )
  const faviconURL = await page.locator('link[rel="icon"]').getAttribute('href')
  expect(faviconURL).toBe('/paper-trail.svg')
  const favicon = await page.request.get(`${url}${faviconURL}`)
  expect(favicon.ok()).toBe(true)
  expect(await favicon.text()).toContain('fill-rule="evenodd"')
  const rgb = (hex: string) =>
    `rgb(${hex
      .slice(1)
      .match(/../g)!
      .map((channel) => parseInt(channel, 16))
      .join(', ')})`
  const checkBackground = async (selector: string, hex: string) => {
    // Columns transition between palettes; wait for the final rendered color.
    await page.waitForFunction(
      ({ selector, expected }) => {
        const element = document.querySelector(selector)
        return element && getComputedStyle(element).backgroundColor === expected
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
    expect(await accentValue()).toBe(light)
    await expect(brand).toHaveCSS('background-color', rgb(light))
  }
  await page.getByRole('button', { name: 'Switch to dark mode' }).click()
  for (const [label, , dark] of colors) {
    await chooseAccent(label)
    expect(await accentValue()).toBe(dark)
    await expect(brand).toHaveCSS('background-color', rgb(dark))
    const [background, surface, sidebar, column, input, border] = darkSurfaces[label]
    await checkBackground('html', background)
    await checkBackground('.sidebar', sidebar)
    await checkBackground('.ticket-card', surface)
    await checkBackground('.column', column)
    expect(
      await page
        .locator('.ticket-card')
        .first()
        .evaluate((el) => getComputedStyle(el).borderTopColor),
    ).toBe(rgb(border))
    await page.getByRole('button', { name: 'New ticket', exact: true }).click()
    await checkBackground('.modal', surface)
    await checkBackground('.field-label input', input)
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  }
  await chooseAccent('Lavender')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'lavender')
  await checkBackground('html', darkSurfaces.Lavender[0])
  await page.getByRole('button', { name: 'Switch to light mode' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'lavender')
  expect(await accentValue()).toBe('#786388')
  await checkBackground('html', '#fafaf9')
  await checkBackground('.sidebar', '#f3f3f1')
  await checkBackground('.ticket-card', '#ffffff')
  await page.getByRole('button', { name: 'Choose accent color', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Lavender', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByRole('button', { name: 'Lavender', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(
    page.getByRole('button', { name: 'Choose accent color', exact: true }),
  ).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('button', { name: 'Choose accent color', exact: true })).toBeFocused()
  await page.getByRole('button', { name: 'Choose accent color', exact: true }).click()
  await page.getByRole('heading', { name: 'Overview', exact: true }).click()
  await expect(page.getByRole('group', { name: 'Accent colors', exact: true })).toHaveCount(0)
  await page.evaluate(() => localStorage.setItem('accent', 'unknown-color'))
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'sage')
})

test('mobile navigation and accent controls fit beside a full rich ticket page', async ({
  page,
  serverURL: url,
}) => {
  const { ticket } = await seedBoard(page, url)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(url)
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
  await expect(page.locator('.sidebar.open')).toBeVisible()
  await page.getByRole('button', { name: 'Choose accent color', exact: true }).click()
  const bounds = await page.getByRole('group', { name: 'Accent colors', exact: true }).boundingBox()
  expect(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390).toBeTruthy()
  await page.getByRole('button', { name: 'Clay', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'clay')
  // The backdrop's center is covered by the sidebar; click its exposed edge.
  await page
    .getByRole('button', { name: 'Close navigation', exact: true })
    .click({ position: { x: 375, y: 100 } })
  await page.goto(`${url}/#ticket/${ticket.id}`)
  await expect(page.getByRole('heading', { name: ticket.title, exact: true })).toBeVisible()
  await expect(page.locator('.mermaid-diagram svg')).toHaveCount(2)
  await expect(page.locator('.mermaid-diagram svg').nth(1)).toBeVisible()
  await expect(
    page.getByRole('complementary', { name: 'Ticket details', exact: true }),
  ).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
})

test('appearance remains usable when browser storage is blocked, including additional pages', async ({
  context,
  page,
  serverURL: url,
}) => {
  await context.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error('Storage unavailable')
    }
    Storage.prototype.setItem = () => {
      throw new Error('Storage unavailable')
    }
  })
  // A second page also exercises the automatic context-wide runtime error guard.
  const privatePage = await context.newPage()
  await page.goto(url)
  await privatePage.goto(url)
  await privatePage.getByRole('button', { name: 'Choose accent color', exact: true }).click()
  await privatePage.getByRole('button', { name: 'Slate', exact: true }).click()
  await expect(privatePage.locator('html')).toHaveAttribute('data-accent', 'slate')
  await privatePage.close()
})
