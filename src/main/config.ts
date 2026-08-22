import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

export interface Settings {
  outputMode: 'udp' | 'hls'
  tvIp: string
  tvPort: string
  hlsPort: string
  bitrateKbps: string
  scaleWidth: string
  fps: string
  ffmpegPath: string
  includeAudio: boolean
  audioDevice: string
  encoderPref: string
  captureMethod: string
  audioDelayMs: string
  captureTarget: 'screen' | 'window'
  monitorLabel: string
  windowHandle: string
  windowTitle: string
}

export const DEFAULTS: Settings = {
  outputMode: 'udp',
  tvIp: '192.168.1.50',
  tvPort: '1234',
  hlsPort: '8090',
  bitrateKbps: '8000',
  scaleWidth: '1920',
  fps: '60',
  ffmpegPath: 'ffmpeg',
  includeAudio: false,
  audioDevice: '',
  encoderPref: 'auto',
  captureMethod: 'auto',
  // Tuned by ear against a real TV: audio was landing after the picture, so
  // it gets pulled 112ms earlier. This is a property of that TV's video
  // buffering, not a universal constant -- on other hardware, retune it
  // with the Sync control.
  audioDelayMs: '-112',
  captureTarget: 'screen',
  monitorLabel: '',
  windowHandle: '',
  windowTitle: '',
}

function configPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function loadSettings(): Settings {
  try {
    const raw = readFileSync(configPath(), 'utf8')
    return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULTS } // no file yet, or unreadable -- defaults are fine
  }
}

export function saveSettings(settings: Partial<Settings>): void {
  try {
    const merged = { ...loadSettings(), ...settings }
    mkdirSync(dirname(configPath()), { recursive: true })
    writeFileSync(configPath(), JSON.stringify(merged, null, 2))
  } catch {
    // Non-fatal: it only means settings won't be remembered next launch.
  }
}
