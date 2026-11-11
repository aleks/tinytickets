export type View =
  | { type: 'home' }
  | { type: 'projects' }
  | { type: 'epics' }
  | { type: 'project'; id: number; tab?: 'progress' | 'dependencies' }
  | { type: 'epic'; id: number }
  | { type: 'ticket'; id: number }

export function parseHash(hash: string): View {
  const path = hash.slice(1).split('/')
  if (path[0] === 'projects') return { type: 'projects' }
  if (path[0] === 'epics') return { type: 'epics' }
  if (
    path[0] === 'project' &&
    (path[2] === 'progress' || path[2] === 'dependencies') &&
    Number.isSafeInteger(Number(path[1])) &&
    Number(path[1]) > 0
  )
    return { type: 'project', id: Number(path[1]), tab: path[2] }
  if (
    (path[0] === 'project' || path[0] === 'epic' || path[0] === 'ticket') &&
    Number.isSafeInteger(Number(path[1])) &&
    Number(path[1]) > 0
  )
    return { type: path[0], id: Number(path[1]) }
  return { type: 'home' }
}

export function viewHref(view: View): string {
  return `#${view.type === 'home' ? '' : 'id' in view ? `${view.type}/${view.id}${view.type === 'project' && view.tab ? `/${view.tab}` : ''}` : view.type}`
}

export function initialView(): View {
  return parseHash(location.hash)
}
