import { contextBridge, ipcRenderer } from 'electron'

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

  probeFfmpeg: (override?: string) => ipcRenderer.invoke('ffmpeg:probe', override),
  listDisplays: () => ipcRenderer.invoke('displays:list'),
  listAudioDevices: (override?: string) => ipcRenderer.invoke('audio:list', override),
  detectEncoder: (override: string | undefined, pref: string) =>
    ipcRenderer.invoke('encoder:detect', override, pref),

  discover: () => ipcRenderer.invoke('discover:ssdp'),
  scanNetwork: () => ipcRenderer.invoke('network:scan'),

  startStream: (payload: unknown) => ipcRenderer.invoke('stream:start', payload),
  stopStream: () => ipcRenderer.invoke('stream:stop'),
  streamStatus: () => ipcRenderer.invoke('stream:status'),

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
}

contextBridge.exposeInMainWorld('lancast', api)
export type LancastApi = typeof api
