import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { NO_WINDOW } from './ffmpeg.js'
import { getLocalIp } from './discovery.js'

const execFileAsync = promisify(execFile)

export interface NetDevice {
  ip: string
  mac: string
}

/** Multicast/broadcast entries aren't real devices you can stream to. */
function isRealDeviceMac(mac: string): boolean {
  const m = mac.toLowerCase().replace(/-/g, ':')
  if (m === 'ff:ff:ff:ff:ff:ff') return false
  if (m.startsWith('01:00:5e')) return false // IPv4 multicast
  if (m.startsWith('33:33')) return false    // IPv6 multicast
  if (m.startsWith('01:80:c2')) return false // spanning tree
  return /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(m)
}

/** Pings an address to coax it into the ARP table. Failure is expected. */
async function pingOnce(ip: string): Promise<void> {
  const args = process.platform === 'win32'
    ? ['-n', '1', '-w', '400', ip]
    : ['-c', '1', '-W', '1', ip]
  try {
    await execFileAsync('ping', args, { timeout: 2000, ...NO_WINDOW })
  } catch { /* unreachable hosts are normal -- we only want the ARP entry */ }
}

/**
 * Lists devices on the local network with their MAC addresses, so a TV can
 * be identified by hand when SSDP discovery doesn't surface it.
 *
 * Works by sweeping the subnet with pings to populate the OS ARP cache,
 * then reading that cache. All of it is local-network traffic.
 */
export async function scanNetwork(
  onProgress?: (done: number, total: number) => void,
): Promise<NetDevice[]> {
  const localIp = getLocalIp()
  if (!localIp) return []

  const base = localIp.split('.').slice(0, 3).join('.')
  const hosts = Array.from({ length: 254 }, (_, i) => `${base}.${i + 1}`)

  let done = 0
  const CONCURRENCY = 64
  for (let i = 0; i < hosts.length; i += CONCURRENCY) {
    await Promise.all(hosts.slice(i, i + CONCURRENCY).map(async (ip) => {
      await pingOnce(ip)
      done += 1
      onProgress?.(done, hosts.length)
    }))
  }

  let arpOut = ''
  try {
    const { stdout } = await execFileAsync('arp', ['-a'], { timeout: 15000, ...NO_WINDOW })
    arpOut = stdout
  } catch {
    return []
  }

  const devices = new Map<string, string>()
  const re = /(\d{1,3}(?:\.\d{1,3}){3})\s+([0-9a-fA-F]{2}(?:[:-][0-9a-fA-F]{2}){5})/g
  let m: RegExpExecArray | null
  while ((m = re.exec(arpOut)) !== null) {
    const [, ip, mac] = m
    if (isRealDeviceMac(mac)) devices.set(ip, mac.toLowerCase().replace(/-/g, ':'))
  }
  return [...devices.entries()]
    .map(([ip, mac]) => ({ ip, mac }))
    .sort((a, b) => {
      const na = a.ip.split('.').map(Number)
      const nb = b.ip.split('.').map(Number)
      for (let i = 0; i < 4; i++) if (na[i] !== nb[i]) return na[i] - nb[i]
      return 0
    })
}
