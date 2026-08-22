export interface Settings {
  tvIp: string
  tvPort: string
  bitrateKbps: string
  scaleWidth: string
  fps: string
  ffmpegPath: string
  includeAudio: boolean
  audioDevice: string
  encoderPref: string
  captureMethod: string
  audioDelayMs: string
  monitorLabel: string
}

export interface DisplayInfo {
  index: number
  label: string
  rect: { left: number; top: number; width: number; height: number }
  primary: boolean
  scaleFactor: number
}

export interface FoundDevice { ip: string; name: string; detail: string }
export interface NetDevice { ip: string; mac: string }

export interface LancastApi {
  loadSettings(): Promise<Settings>
  saveSettings(s: Partial<Settings>): Promise<boolean>
  getDefaults(): Promise<Settings>
  copy(text: string): Promise<boolean>
  openExternal(url: string): Promise<void>
  probeFfmpeg(override?: string): Promise<{ ok: boolean; version: string; path: string }>
  listDisplays(): Promise<DisplayInfo[]>
  listAudioDevices(override?: string): Promise<{ devices: string[]; raw: string }>
  detectEncoder(override: string | undefined, pref: string): Promise<string>
  discover(): Promise<FoundDevice[]>
  scanNetwork(): Promise<NetDevice[]>
  startStream(payload: unknown): Promise<{ ok: boolean; error?: string; encoder?: string; capture?: string }>
  stopStream(): Promise<boolean>
  streamStatus(): Promise<boolean>
  onLog(cb: (line: string) => void): () => void
  onEnded(cb: (code: number | null) => void): () => void
  onScanProgress(cb: (p: { done: number; total: number }) => void): () => void
}

declare global {
  interface Window { lancast: LancastApi }
}

export const api = window.lancast
export const ALL_MONITORS = 'All monitors (full virtual desktop)'
