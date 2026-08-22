import dgram from 'node:dgram'
import { networkInterfaces } from 'node:os'

const SSDP_ADDR = '239.255.255.250'
const SSDP_PORT = 1900
const SEARCH_TARGETS = [
  'urn:schemas-upnp-org:device:MediaRenderer:1',
  'urn:dial-multiscreen-org:service:dial:1',
  'ssdp:all',
]

export interface FoundDevice {
  ip: string
  name: string
  detail: string
}

/**
 * Finds candidate TVs by shouting an SSDP/UPnP discovery request onto the
 * local network and listening for replies. Most smart TVs answer, because
 * they run a DLNA media renderer or a DIAL service for casting.
 *
 * Everything here is multicast to a link-local address -- it never leaves
 * the LAN and never touches the internet.
 */
export function ssdpDiscover(timeoutMs = 3000): Promise<FoundDevice[]> {
  return new Promise((resolve) => {
    const found = new Map<string, FoundDevice>()
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })

    const finish = () => {
      try { sock.close() } catch { /* already closed */ }
      resolve([...found.values()])
    }

    sock.on('error', finish)

    sock.on('message', (msg, rinfo) => {
      const text = msg.toString('utf8')
      const server = /^SERVER:\s*(.+)$/im.exec(text)?.[1]?.trim() ?? ''
      const usn = /^USN:\s*(.+)$/im.exec(text)?.[1]?.trim() ?? ''
      const location = /^LOCATION:\s*(.+)$/im.exec(text)?.[1]?.trim() ?? ''
      const existing = found.get(rinfo.address)
      // Prefer the reply that tells us the most about the device.
      const detail = server || usn || location
      if (!existing || (!existing.detail && detail)) {
        found.set(rinfo.address, { ip: rinfo.address, name: server || 'Unknown device', detail })
      }
    })

    sock.bind(() => {
      try { sock.setBroadcast(true) } catch { /* not fatal */ }
      for (const st of SEARCH_TARGETS) {
        const payload = Buffer.from(
          'M-SEARCH * HTTP/1.1\r\n' +
          `HOST: ${SSDP_ADDR}:${SSDP_PORT}\r\n` +
          'MAN: "ssdp:discover"\r\n' +
          'MX: 2\r\n' +
          `ST: ${st}\r\n\r\n`,
        )
        sock.send(payload, SSDP_PORT, SSDP_ADDR)
      }
      setTimeout(finish, timeoutMs)
    })
  })
}

/** This PC's LAN IPv4 address for the interface that reaches the target. */
export function getLocalIp(): string | null {
  const nets = networkInterfaces()
  const candidates: string[] = []
  for (const addrs of Object.values(nets)) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) candidates.push(a.address)
    }
  }
  // Prefer ordinary private LAN ranges over virtual adapters.
  const preferred = candidates.find((ip) => /^192\.168\./.test(ip))
    ?? candidates.find((ip) => /^10\./.test(ip))
    ?? candidates.find((ip) => /^172\.(1[6-9]|2\d|3[01])\./.test(ip))
  return preferred ?? candidates[0] ?? null
}
