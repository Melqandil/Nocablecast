import net from 'node:net'

export interface StreamSettingsInput {
  outputMode?: 'udp' | 'hls'
  tvIp: string
  tvPort: string
  hlsPort?: string
  bitrateKbps: string
  scaleWidth: string
  fps: string
  audioDelayMs: string
}

function integerInRange(value: string, min: number, max: number): number | null {
  const text = value.trim()
  if (!/^\d+$/.test(text)) return null
  const number = Number(text)
  return Number.isSafeInteger(number) && number >= min && number <= max ? number : null
}

/** Only addresses that cannot be routed across the public internet. */
export function isLocalIpv4(value: string): boolean {
  const ip = value.trim()
  if (!net.isIPv4(ip)) return false
  const [a, b] = ip.split('.').map(Number)
  return a === 10
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 169 && b === 254)
}

/** Returns a user-facing error, or null when the stream can safely start. */
export function validateStreamSettings(settings: StreamSettingsInput): string | null {
  if (!isLocalIpv4(settings.tvIp)) {
    return 'TV IP must be a private local-network IPv4 address (for example 192.168.1.50).'
  }

  const outputMode = settings.outputMode ?? 'udp'
  const port = outputMode === 'hls' ? settings.hlsPort ?? '' : settings.tvPort
  if (integerInRange(port, 1, 65535) === null) {
    return `${outputMode === 'hls' ? 'HTTP' : 'UDP'} port must be a whole number from 1 to 65535.`
  }

  const width = integerInRange(settings.scaleWidth, 2, 16384)
  if (width === null || width % 2 !== 0) {
    return 'Width must be an even whole number from 2 to 16384.'
  }

  if (integerInRange(settings.fps, 1, 240) === null) {
    return 'FPS must be a whole number from 1 to 240.'
  }

  if (integerInRange(settings.bitrateKbps, 1, 1_000_000) === null) {
    return 'Bitrate must be a positive whole number no greater than 1000000 kbps.'
  }

  const delay = settings.audioDelayMs.trim()
  if (!/^-?\d+$/.test(delay) || Math.abs(Number(delay)) > 60_000) {
    return 'Sync must be a whole number of milliseconds from -60000 to 60000.'
  }

  return null
}
