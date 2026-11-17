import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, resolve, sep, extname } from 'node:path'

export function siteServer(directory, prefix = '/') {
  const root = resolve(directory)
  if (!prefix.startsWith('/') || !prefix.endsWith('/'))
    throw new Error('Prefix must start and end with /')
  return createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end()
      return
    }
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
      if (prefix !== '/' && pathname === prefix.slice(0, -1)) {
        response.writeHead(301, { Location: prefix }).end()
        return
      }
      if (!pathname.startsWith(prefix)) {
        response.writeHead(404).end()
        return
      }
      const relative = pathname.slice(prefix.length) || 'index.html'
      const file = resolve(join(root, relative))
      if (
        !file.startsWith(root + sep) ||
        relative.split(/[\\/]/).some((part) => part.startsWith('.'))
      ) {
        response.writeHead(404).end()
        return
      }
      const info = await stat(file)
      if (!info.isFile()) {
        response.writeHead(404).end()
        return
      }
      const body = await readFile(file)
      const mime =
        {
          '.html': 'text/html; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.json': 'application/json',
          '.svg': 'image/svg+xml',
          '.png': 'image/png',
        }[extname(file)] || 'application/octet-stream'
      response.writeHead(200, {
        'Content-Type': mime,
        'Content-Length': body.length,
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
      })
      response.end(request.method === 'HEAD' ? undefined : body)
    } catch (error) {
      response.writeHead(error instanceof URIError ? 400 : 404).end()
    }
  })
}
