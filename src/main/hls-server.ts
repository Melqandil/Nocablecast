import { createReadStream, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { resolve } from 'node:path'

export interface HlsServerOptions {
  root: string
  bindAddress: string
  advertisedAddress: string
  port: number
}

export interface HlsServerInfo {
  directUrl: string
  playlistUrl: string
  port: number
}

let current: Server | null = null

function sendText(
  response: import('node:http').ServerResponse,
  status: number,
  contentType: string,
  body: string,
): void {
  response.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
  })
  response.end(body)
}

/**
 * Serves only the rolling HLS playlist and its generated MPEG-TS segments.
 * Binding to one LAN address prevents the receiver from being exposed on
 * loopback, VPN, or unrelated network adapters.
 */
export async function startHlsServer(options: HlsServerOptions): Promise<HlsServerInfo> {
  await stopHlsServer()

  const root = resolve(options.root)
  let directUrl = ''
  const server = createServer((request, response) => {
    const method = request.method ?? 'GET'
    if (method !== 'GET' && method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' })
      response.end()
      return
    }

    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
    if (pathname === '/nocablecast.m3u') {
      const body = `#EXTM3U\n#EXTINF:-1,Nocablecast Desktop\n${directUrl}\n`
      if (method === 'HEAD') {
        response.writeHead(200, {
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Content-Type': 'audio/x-mpegurl',
          'Content-Length': Buffer.byteLength(body),
        })
        response.end()
      } else {
        sendText(response, 200, 'audio/x-mpegurl', body)
      }
      return
    }

    const name = pathname.slice(1)
    if (name !== 'live.m3u8' && !/^segment_\d{6}\.ts$/.test(name)) {
      sendText(response, 404, 'text/plain; charset=utf-8', 'Not found.\n')
      return
    }

    const file = resolve(root, name)
    try {
      const stat = statSync(file)
      if (!stat.isFile()) throw new Error('not a file')
      response.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Content-Type': name.endsWith('.m3u8')
          ? 'application/vnd.apple.mpegurl'
          : 'video/mp2t',
        'Content-Length': stat.size,
      })
      if (method === 'HEAD') response.end()
      else createReadStream(file).on('error', () => response.destroy()).pipe(response)
    } catch {
      sendText(response, 404, 'text/plain; charset=utf-8', 'Stream is starting; try again.\n')
    }
  })

  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(options.port, options.bindAddress, () => resolveListen())
  })

  current = server
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : options.port
  const base = `http://${options.advertisedAddress}:${port}`
  directUrl = `${base}/live.m3u8`
  return { directUrl, playlistUrl: `${base}/nocablecast.m3u`, port }
}

export async function stopHlsServer(): Promise<void> {
  const server = current
  current = null
  if (!server) return

  server.closeAllConnections?.()
  await new Promise<void>((resolveClose) => {
    server.close(() => resolveClose())
  })
}
