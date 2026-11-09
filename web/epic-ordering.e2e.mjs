import assert from 'node:assert/strict'

export async function testProjectEpicOrdering(page, url) {
  const create = async (kind, data) => {
    const response = await page.request.post(`${url}/api/${kind}`, { data })
    assert.equal(response.status(), 201)
    return response.json()
  }
  const project = await create('projects', { name: 'Epic ordering' })
  const oldActive = await create('epics', { project_id: project.id, title: 'Old active' })
  const oldCompleted = await create('epics', { project_id: project.id, title: 'Old completed', completed: true })
  await create('epics', { project_id: project.id, title: 'New active' })
  await create('epics', { project_id: project.id, title: 'New completed', completed: true })
  const foreign = await create('projects', { name: 'Other ordering project' })
  await create('epics', { project_id: foreign.id, title: 'Foreign epic' })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`${url}/#project/${project.id}`)
  await page.getByRole('heading', { name: project.name, exact: true }).waitFor()
  const ordered = async titles => {
    await page.waitForFunction(expected => JSON.stringify(Array.from(document.querySelectorAll('.epic-grid .epic-card h3'), el => el.textContent)) === JSON.stringify(expected), titles)
  }
  await ordered(['New active', 'Old active', 'New completed', 'Old completed'])
  const newest = await create('epics', { project_id: project.id, title: 'Newest epic' })
  await ordered(['Newest epic', 'New active', 'Old active', 'New completed', 'Old completed'])
  const complete = await page.request.patch(`${url}/api/epics/${newest.id}`, { data: { completed: true } })
  assert.equal(complete.status(), 200)
  await ordered(['New active', 'Old active', 'Newest epic', 'New completed', 'Old completed'])
  const reopen = await page.request.patch(`${url}/api/epics/${oldCompleted.id}`, { data: { completed: false } })
  assert.equal(reopen.status(), 200)
  await ordered(['New active', 'Old completed', 'Old active', 'Newest epic', 'New completed'])
  const search = page.getByRole('textbox', { name: 'Search tickets', exact: true })
  await search.fill('active')
  await ordered(['New active', 'Old active'])
  await search.fill('')
  await ordered(['New active', 'Old completed', 'Old active', 'Newest epic', 'New completed'])
  await page.reload()
  await ordered(['New active', 'Old completed', 'Old active', 'Newest epic', 'New completed'])
  // Presentation ordering must not mutate the shared workspace array or change
  // the existing sidebar order and ticket assignment defaults.
  const names = ['Old active', 'Old completed', 'New active', 'New completed', 'Newest epic']
  const sidebar = await page.locator('.nav-epic-text > span:first-child').allTextContents()
  assert.deepEqual(sidebar.filter(title => names.includes(title)), names)
  await page.getByRole('button', { name: 'New ticket', exact: true }).click()
  assert.equal(await page.getByRole('dialog').locator('select').nth(1).inputValue(), String(oldActive.id))
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await ordered(['New active', 'Old completed', 'Old active', 'Newest epic', 'New completed'])
}
