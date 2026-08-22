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

export interface DisplayInfo {
  index: number
  label: string
  rect: { left: number; top: number; width: number; height: number }
  primary: boolean
  scaleFactor: number
}

export interface WindowInfo {
  id: string
  handle: string
  title: string
}

export interface FoundDevice { ip: string; name: string; detail: string }
export interface NetDevice { ip: string; mac: string }

export interface UpdateState {
  phase: 'disabled' | 'idle' | 'checking' | 'available' | 'downloading' | 'installing' | 'error'
  currentVersion: string
  version?: string
  percent?: number
  message?: string
}

export interface LancastApi {
  loadSettings(): Promise<Settings>
  saveSettings(s: Partial<Settings>): Promise<boolean>
  getDefaults(): Promise<Settings>
  copy(text: string): Promise<boolean>
  openExternal(url: string): Promise<void>
  probeFfmpeg(override?: string): Promise<{ ok: boolean; version: string; path: string }>
  listDisplays(): Promise<DisplayInfo[]>
  listWindows(): Promise<WindowInfo[]>
  listAudioDevices(override?: string): Promise<{ devices: string[]; raw: string }>
  detectEncoder(override: string | undefined, pref: string): Promise<string>
  discover(): Promise<FoundDevice[]>
  scanNetwork(): Promise<NetDevice[]>
  getLocalIp(targetIp: string): Promise<string | null>
  startStream(payload: unknown): Promise<{
    ok: boolean
    error?: string
    encoder?: string
    capture?: string
    tvUrl?: string
    playlistUrl?: string
    directUrl?: string
  }>
  stopStream(): Promise<boolean>
  streamStatus(): Promise<boolean>
  updateStatus(): Promise<UpdateState>
  installUpdate(): Promise<{ ok: boolean; error?: string }>
  onLog(cb: (line: string) => void): () => void
  onEnded(cb: (code: number | null) => void): () => void
  onScanProgress(cb: (p: { done: number; total: number }) => void): () => void
  onUpdateStatus(cb: (state: UpdateState) => void): () => void
}

declare global {
  interface Window { lancast: LancastApi }
}

export const api = window.lancast
export const ALL_MONITORS = 'All monitors (full virtual desktop)'
