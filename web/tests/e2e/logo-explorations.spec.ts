import { test, expect } from './fixtures'

test('logo gallery has stable names, both modes, supported palettes and mobile previews', async ({
  page,
  serverURL,
}) => {
  await page.goto(`${serverURL}/logo-explorations.html`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Small mark. Clear purpose.')
  await expect(page.locator('article')).toHaveCount(6)
  await expect(page.locator('.preview')).toHaveCount(12)
  await expect(page.locator('.mini')).toHaveCount(60)
  const palettes = [
    ['Sage', '#3c6957', '#658f75'],
    ['Slate', '#526c80', '#617e95'],
    ['Lavender', '#786388', '#89729b'],
    ['Clay', '#916956', '#a17862'],
    ['Sand', '#85713e', '#948049'],
  ] as const
  for (const [name, light, dark] of palettes) {
    const button = page.getByRole('button', { name, exact: true })
    await button.click()
    await expect(button).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('button[aria-pressed="true"]')).toHaveCount(1)
    for (const [mode, color] of [
      ['light', light],
      ['dark', dark],
    ]) {
      const previews = page.locator(`.preview[data-mode="${mode}"]`)
      expect(
        await previews.evaluateAll((elements) =>
          elements.map((element) => getComputedStyle(element).getPropertyValue('--accent').trim()),
        ),
      ).toEqual(Array(6).fill(color))
      await expect(previews.first()).toHaveAttribute(
        'aria-label',
        `Ticket Fold, ${mode} mode, ${name} palette`,
      )
    }
  }
  await page.getByRole('button', { name: 'Sage', exact: true }).focus()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Slate', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('link', { name: 'Quiet Board', exact: true }).click()
  await expect(page).toHaveURL(/#quiet-board$/)
  await page.reload()
  await expect(page.locator('#quiet-board')).toBeInViewport()
  for (const width of [375, 320]) {
    await page.setViewportSize({ width, height: 800 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const sizes = await page
      .locator('.sizes svg')
      .evaluateAll((elements) =>
        elements.slice(0, 3).map((element) => element.getBoundingClientRect().width),
      )
    expect(sizes).toEqual([16, 24, 32])
  }
  expect(await page.evaluate(() => localStorage.length)).toBe(0)
})
