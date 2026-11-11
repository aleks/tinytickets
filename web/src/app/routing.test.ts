import { describe, expect, it } from 'vitest'
import { parseHash, viewHref, type View } from './routing'

describe('hash routing', () => {
  const routes: View[] = [
    { type: 'home' },
    { type: 'projects' },
    { type: 'epics' },
    { type: 'project', id: 1 },
    { type: 'project', id: 24, tab: 'progress' },
    { type: 'project', id: 24, tab: 'dependencies' },
    { type: 'epic', id: 13 },
    { type: 'ticket', id: Number.MAX_SAFE_INTEGER },
  ]

  it.each(routes)('round trips $type', (route) => {
    expect(parseHash(viewHref(route))).toEqual(route)
  })

  it.each([
    '',
    '#',
    '#unknown',
    '#ticket',
    '#ticket/0',
    '#epic/-1',
    '#project/1.5',
    '#ticket/NaN',
    '#project/Infinity',
    '#ticket/9007199254740992',
    '#project/0/progress',
  ])('falls back to overview for invalid route %s', (hash) => {
    expect(parseHash(hash)).toEqual({ type: 'home' })
  })

  it('preserves existing permissive suffix and numeric parsing behavior', () => {
    expect(parseHash('#project/12/unknown')).toEqual({ type: 'project', id: 12 })
    expect(parseHash('#project/12/progress/extra')).toEqual({
      type: 'project',
      id: 12,
      tab: 'progress',
    })
    expect(parseHash('#ticket/01')).toEqual({ type: 'ticket', id: 1 })
    expect(parseHash('#projects/ignored')).toEqual({ type: 'projects' })
  })

  it('keeps public deep links unchanged', () => {
    expect(routes.map(viewHref)).toEqual([
      '#',
      '#projects',
      '#epics',
      '#project/1',
      '#project/24/progress',
      '#project/24/dependencies',
      '#epic/13',
      '#ticket/9007199254740991',
    ])
  })
})
