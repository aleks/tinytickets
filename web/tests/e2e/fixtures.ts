import { test as base, expect, type Page } from 'playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

function startServer(server: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let logs = ''
    const timeout = setTimeout(
      () => fail(new Error(`Server did not start within 10 seconds: ${logs}`)),
      10_000,
    )
    const cleanup = () => {
      clearTimeout(timeout)
      server.off('error', fail)
      server.off('exit', onExit)
      server.stderr?.off('data', onData)
    }
    const fail = (error: Error) => {
      cleanup()
      reject(error)
    }
    const onExit = (code: number | null) => fail(new Error(`Server exited (${code}): ${logs}`))
    const onData = (chunk: Buffer) => {
      logs += chunk.toString()
      const match = logs.match(/url=(http:\/\/[^\s"]+)/)
      if (match) {
        cleanup()
        resolve(match[1])
      }
    }
    server.once('error', fail)
    server.once('exit', onExit)
    server.stderr?.on('data', onData)
  })
}

async function stopServer(server: ChildProcess): Promise<void> {
  if (!server.pid || server.exitCode !== null || server.signalCode !== null) return
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(terminate)
      clearTimeout(kill)
      server.off('exit', exited)
    }
    const exited = () => {
      cleanup()
      resolve()
    }
    const terminate = setTimeout(() => server.kill('SIGKILL'), 3000)
    const kill = setTimeout(() => {
      cleanup()
      reject(new Error('Test server did not exit after SIGKILL'))
    }, 6000)
    server.once('exit', exited)
    server.kill('SIGTERM')
  })
}

export const test = base.extend<{ serverURL: string; runtimeErrors: void }>({
  // Playwright requires destructuring even when a fixture has no dependencies.
  // eslint-disable-next-line no-empty-pattern
  serverURL: async ({}, use) => {
    const directory = await mkdtemp(join(tmpdir(), 'tinytickets-e2e-'))
    // Never use a running workspace server or an existing database.
    const server = spawn(
      fileURLToPath(new URL('../../../tinytickets', import.meta.url)),
      ['--addr', '127.0.0.1:0', '--db', join(directory, 'test.db')],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    )
    try {
      const url = await startServer(server)
      // Keep draining stderr after readiness so a verbose server cannot block.
      server.stderr?.resume()
      await use(url)
    } finally {
      await stopServer(server)
      await rm(directory, { recursive: true, force: true })
    }
  },
  baseURL: async ({ serverURL }, use) => {
    await use(serverURL)
  },
  runtimeErrors: [
    async ({ context }, use) => {
      const errors: string[] = []
      const monitor = (page: Page) => {
        page.on('pageerror', (error) => errors.push(error.message))
      }
      for (const page of context.pages()) monitor(page)
      context.on('page', monitor)
      await use()
      context.off('page', monitor)
      expect(errors, 'Uncaught browser errors across all test pages').toEqual([])
    },
    { auto: true },
  ],
})

export { expect } from 'playwright/test'
