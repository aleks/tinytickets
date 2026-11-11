import { CheckCheck, CheckCircle2, Circle, CircleDot } from 'lucide-react'
import type { Status } from './types'

export const statusMetadata = {
  todo: { status: 'todo', label: 'Todo', icon: Circle },
  in_progress: { status: 'in_progress', label: 'In progress', icon: CircleDot },
  ready_for_review: { status: 'ready_for_review', label: 'Ready for review', icon: CheckCircle2 },
  done: { status: 'done', label: 'Done', icon: CheckCheck },
} as const satisfies Record<Status, { status: Status; label: string; icon: typeof Circle }>

export const statuses = Object.values(statusMetadata)
export function isStatus(value: string): value is Status {
  return Object.hasOwn(statusMetadata, value)
}
