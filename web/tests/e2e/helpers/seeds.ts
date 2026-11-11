import type { Page } from 'playwright/test'
import { api } from './api'

export function richDescription(epicID: number): string {
  return [
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
    `[Epic](#epic/${epicID})`,
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
}

export async function seedBoard(page: Page, url: string) {
  const { create } = api(page.request, url)
  const project = await create('projects', { name: 'TinyTickets' })
  const epic = await create('epics', { project_id: project.id, title: 'First release' })
  const description = richDescription(epic.id)
  const ticket = await create('tickets', {
    epic_id: epic.id,
    title: 'Board is ready',
    description,
    status: 'done',
  })
  const review = await create('tickets', { epic_id: epic.id, title: 'Review the release' })
  await create('links', { blocker_id: ticket.id, blocked_id: review.id })
  return { project, epic, ticket, review, description }
}
