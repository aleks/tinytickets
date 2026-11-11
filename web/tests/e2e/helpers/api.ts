import assert from 'node:assert/strict'
import type { APIRequestContext } from 'playwright/test'

export interface Project {
  id: number
  name: string
}
export interface Epic {
  id: number
  project_id: number
  title: string
  completed: boolean
  archived: boolean
}
export interface Ticket {
  id: number
  epic_id: number
  title: string
  description: string
  status: string
  status_since: string | null
  updated_at: string
}
type Entity<K extends string> = K extends 'projects'
  ? Project
  : K extends 'epics'
    ? Epic
    : K extends 'tickets'
      ? Ticket
      : unknown

export function api(request: APIRequestContext, url: string) {
  return {
    async create<K extends string>(kind: K, data: Record<string, unknown>): Promise<Entity<K>> {
      const response = await request.post(`${url}/api/${kind}`, { data })
      assert.equal(response.status(), 201, await response.text())
      return response.json()
    },
    async patch<K extends string>(
      kind: K,
      id: number,
      data: Record<string, unknown>,
    ): Promise<Entity<K>> {
      const response = await request.patch(`${url}/api/${kind}/${id}`, { data })
      assert.equal(response.status(), 200, await response.text())
      return response.json()
    },
  }
}
