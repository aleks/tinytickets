import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { binaryPath, stopServer } from '../fixtures'

type Reply = { id?: number; error?: { message: string }; result?: { isError?: boolean } }

// Connect an actual stdio process to this test's fixture DB, never the workspace.
export async function appendThroughStdio(databasePath: string, ticketID: number, body: string) {
  const process = spawn(binaryPath, ['--mcp-stdio', '--db', databasePath], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const output = createInterface({ input: process.stdout })
  const pending = new Map<
    number,
    { resolve: (reply: Reply) => void; reject: (error: Error) => void }
  >()
  let id = 0
  output.on('line', (line) => {
    const reply = JSON.parse(line) as Reply
    if (reply.id !== undefined) pending.get(reply.id)?.resolve(reply)
  })
  process.on('error', (error) => pending.forEach((request) => request.reject(error)))
  process.on('exit', () =>
    pending.forEach((request) => request.reject(new Error('Stdio process exited'))),
  )
  process.stderr.resume()

  function request(method: string, params: object): Promise<Reply> {
    const requestID = ++id
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestID)
        reject(new Error(`Stdio ${method} timed out`))
      }, 10000)
      const finish = (reply: Reply) => {
        clearTimeout(timer)
        pending.delete(requestID)
        if (reply.error) reject(new Error(reply.error.message))
        else resolve(reply)
      }
      pending.set(requestID, {
        resolve: finish,
        reject: (error) => {
          clearTimeout(timer)
          pending.delete(requestID)
          reject(error)
        },
      })
      process.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestID, method, params }) + '\n')
    })
  }
  try {
    await request('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'live-sync-browser-test', version: '1' },
    })
    process.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n',
    )
    const result = await request('tools/call', {
      name: 'add_work_log',
      arguments: { ticket_id: ticketID, body },
    })
    if (result.result?.isError) throw new Error('Stdio add_work_log failed')
  } finally {
    output.close()
    await stopServer(process)
  }
}
