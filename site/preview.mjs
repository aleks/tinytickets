import { fileURLToPath } from 'node:url'
import { once } from 'node:events'
import { access } from 'node:fs/promises'
import { siteServer } from './lib/server.mjs'

const directory = fileURLToPath(new URL('./dist/', import.meta.url))
await access(new URL('./dist/index.html', import.meta.url))
const port = Number(process.env.PORT || 4173)
if (!Number.isSafeInteger(port) || port < 0 || port > 65535)
  throw new Error('PORT must be a valid port number')
const server = siteServer(directory)
server.listen(port, '127.0.0.1')
await once(server, 'listening')
console.log(`Documentation preview: http://127.0.0.1:${server.address().port}`)
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close())
