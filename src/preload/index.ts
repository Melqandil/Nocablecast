import { contextBridge, ipcRenderer } from 'electron'

interface UpdateState {
  phase: 'disabled' | 'idle' | 'checking' | 'available' | 'downloading' | 'installing' | 'error'
  currentVersion: string
  version?: string
  percent?: number
  message?: string
}

/**
 * The only surface the UI can reach. Node stays in the main process; the
 * renderer gets a small, explicit set of calls and nothing else.
 */
const api = {
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (s: unknown) => ipcRenderer.invoke('settings:save', s),
  getDefaults: () => ipcRenderer.invoke('settings:defaults'),

  copy: (text: string) => ipcRenderer.invoke('app:copy', text),
  openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
  openWirelessDisplayPicker: () => ipcRenderer.invoke('display:wireless-picker'),
  useExtendMode: () => ipcRenderer.invoke('display:extend'),

  probeFfmpeg: (override?: string) => ipcRenderer.invoke('ffmpeg:probe', override),
  listDisplays: () => ipcRenderer.invoke('displays:list'),
  listWindows: () => ipcRenderer.invoke('windows:list'),
  listAudioDevices: (override?: string) => ipcRenderer.invoke('audio:list', override),
  detectEncoder: (override: string | undefined, pref: string) =>
    ipcRenderer.invoke('encoder:detect', override, pref),

  discover: () => ipcRenderer.invoke('discover:ssdp'),
  scanNetwork: () => ipcRenderer.invoke('network:scan'),
  getLocalIp: (targetIp: string) => ipcRenderer.invoke('network:local-ip', targetIp),

  startStream: (payload: unknown) => ipcRenderer.invoke('stream:start', payload),
  stopStream: () => ipcRenderer.invoke('stream:stop'),
  streamStatus: () => ipcRenderer.invoke('stream:status'),

  startPhoneCamera: () => ipcRenderer.invoke('phone-camera:start'),
  stopPhoneCamera: () => ipcRenderer.invoke('phone-camera:stop'),
  phoneCameraStatus: () => ipcRenderer.invoke('phone-camera:status'),
  sendPhoneCameraSignal: (message: unknown) => ipcRenderer.send('phone-camera:signal', message),
  sendPhoneCameraFrame: (frame: Uint8Array) => ipcRenderer.send('phone-camera:frame', frame),
  installVirtualCamera: () => ipcRenderer.invoke('virtual-camera:install'),
  startVirtualCamera: () => ipcRenderer.invoke('virtual-camera:start'),
  stopVirtualCamera: () => ipcRenderer.invoke('virtual-camera:stop'),

  updateStatus: () => ipcRenderer.invoke('update:status'),
  installUpdate: () => ipcRenderer.invoke('update:install'),

  onLog: (cb: (line: string) => void) => {
    const h = (_e: unknown, line: string) => cb(line)
    ipcRenderer.on('stream:log', h)
    return () => ipcRenderer.removeListener('stream:log', h)
  },
  onEnded: (cb: (code: number | null) => void) => {
    const h = (_e: unknown, code: number | null) => cb(code)
    ipcRenderer.on('stream:ended', h)
    return () => ipcRenderer.removeListener('stream:ended', h)
  },
  onScanProgress: (cb: (p: { done: number; total: number }) => void) => {
    const h = (_e: unknown, p: { done: number; total: number }) => cb(p)
    ipcRenderer.on('network:progress', h)
    return () => ipcRenderer.removeListener('network:progress', h)
  },
  onUpdateStatus: (cb: (state: UpdateState) => void) => {
    const h = (_e: unknown, state: UpdateState) => cb(state)
    ipcRenderer.on('update:status', h)
    return () => ipcRenderer.removeListener('update:status', h)
  },
  onPhoneCameraSignal: (cb: (message: unknown) => void) => {
    const h = (_e: unknown, message: unknown) => cb(message)
    ipcRenderer.on('phone-camera:signal', h)
    return () => ipcRenderer.removeListener('phone-camera:signal', h)
  },
  onPhoneCameraFrame: (cb: (frame: Uint8Array) => void) => {
    const h = (_e: unknown, frame: Uint8Array) => cb(frame)
    ipcRenderer.on('phone-camera:jpeg', h)
    return () => ipcRenderer.removeListener('phone-camera:jpeg', h)
  },
  onPhoneCameraState: (cb: (state: unknown) => void) => {
    const h = (_e: unknown, state: unknown) => cb(state)
    ipcRenderer.on('phone-camera:state', h)
    return () => ipcRenderer.removeListener('phone-camera:state', h)
  },
}

contextBridge.exposeInMainWorld('lancast', api)
export type LancastApi = typeof api
