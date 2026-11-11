import type { Project, Epic, Ticket, Status } from '../../shared/types'

export type Dialog =
  | { type: 'project'; item?: Project }
  | { type: 'epic'; item?: Epic; projectId?: number }
  | { type: 'ticket'; item?: Ticket; epicId?: number; status?: Status }
