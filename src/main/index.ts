import { app, BrowserWindow, ipcMain, shell, clipboard } from 'electron'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import net from 'node:net'

import { buildCommand, type MonitorRect } from './command.js'
import { resolveFfmpeg, probeFfmpeg } from './ffmpeg.js'
import { detectEncoder, testDdagrab } from './encoders.js'
import { enumerateDisplays } from './displays.js'
import { listAudioDevices } from './audio.js'
import { ssdpDiscover, getLocalIp } from './discovery.js'
import { scanNetwork } from './network.js'
import { loadSettings, saveSettings, DEFAULTS, type Settings } from './config.js'
import { startStream, stopStream, isStreaming } from './stream.js'

const here = dirname(fileURLToPath(import.meta.url))
let win: BrowserWindow | null = null

function log(line: string): void {
  win?.webContents.send('stream:log', line)
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1180,
    height: 880,
    minWidth: 940,
    minHeight: 640,
    show: false,
    backgroundColor: '#e8e4d9',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(here, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.on('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(here, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopStream()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', stopStream)

// ---------------------------------------------------------------- IPC --

ipcMain.handle('settings:load', () => loadSettings())
ipcMain.handle('settings:save', (_e, s: Partial<Settings>) => { saveSettings(s); return true })
ipcMain.handle('settings:defaults', () => DEFAULTS)

ipcMain.handle('app:copy', (_e, text: string) => { clipboard.writeText(text); return true })
ipcMain.handle('app:openExternal', (_e, url: string) => shell.openExternal(url))

ipcMain.handle('ffmpeg:probe', async (_e, override?: string) => {
  const path = resolveFfmpeg(override)
  const { ok, version } = await probeFfmpeg(path)
  return { ok, version, path }
})

ipcMain.handle('displays:list', () => enumerateDisplays())

ipcMain.handle('audio:list', async (_e, override?: string) => {
  const path = resolveFfmpeg(override)
  return listAudioDevices(path)
})

ipcMain.handle('encoder:detect', async (_e, override: string | undefined, pref: string) => {
  const path = resolveFfmpeg(override)
  const [name] = await detectEncoder(path, pref, log)
  return name
})

ipcMain.handle('discover:ssdp', () => ssdpDiscover(3000))

ipcMain.handle('network:scan', async (event) => {
  return scanNetwork((done, total) => {
    event.sender.send('network:progress', { done, total })
  })
})

ipcMain.handle('stream:status', () => isStreaming())
ipcMain.handle('stream:stop', () => { stopStream(); return true })

export interface StartPayload {
  settings: Settings
  monitor: MonitorRect | null
  monitorIndex: number
}

ipcMain.handle('stream:start', async (_e, payload: StartPayload) => {
  const { settings, monitor, monitorIndex } = payload
  const ffmpeg = resolveFfmpeg(settings.ffmpegPath)

  const probe = await probeFfmpeg(ffmpeg)
  if (!probe.ok) {
    log(`ffmpeg could not be run at: ${ffmpeg}`)
    return { ok: false, error: 'ffmpeg not found or not runnable.' }
  }

  const audioDevice = settings.includeAudio ? settings.audioDevice.trim() : ''
  if (settings.includeAudio && !audioDevice) {
    return { ok: false, error: "Audio is enabled but no device is selected. Pick one, or turn audio off." }
  }

  const audioDelayMs = parseInt(settings.audioDelayMs || '0', 10)
  if (!Number.isFinite(audioDelayMs)) {
    return { ok: false, error: 'Sync must be a whole number of milliseconds (it may be negative).' }
  }

  const [encoder, encoderArgs] = await detectEncoder(ffmpeg, settings.encoderPref, log)

  // Resolve how the screen gets captured. Desktop Duplication is far faster
  // but isn't available everywhere, so unless GDI was forced we verify it
  // works before committing a live stream to it.
  let capture: 'ddagrab' | 'gdigrab'
  if (settings.captureMethod === 'gdigrab') {
    capture = 'gdigrab'
    log('Capture method: GDI (chosen manually).')
  } else {
    const { ok, detail } = await testDdagrab(ffmpeg, monitorIndex)
    if (ok) {
      capture = 'ddagrab'
      log('Capture method: Desktop Duplication (GPU).')
    } else {
      capture = 'gdigrab'
      const reason = detail ? ` (${detail})` : ''
      log(settings.captureMethod === 'ddagrab'
        ? `Desktop Duplication was selected but isn't usable here${reason} -- falling back to GDI capture.`
        : `Capture method: GDI (Desktop Duplication unavailable${reason}).`)
    }
  }

  if (capture === 'gdigrab' && parseInt(settings.fps, 10) > 30) {
    log('Note: GDI capture copies every frame through the CPU and often cannot sustain more than ~30fps at 1080p. If the picture looks choppy, lower FPS to 30 or get Desktop Duplication working.')
  }

  const localIp = getLocalIp()
  const bindIp = localIp && net.isIPv4(localIp) ? localIp : null

  log(`This PC's LAN IP: ${localIp ?? '(unknown)'}`)
  log(`Streaming to: ${settings.tvIp}:${settings.tvPort}`)
  if (audioDevice) {
    log(`Audio device: ${audioDevice}`)
    log('Audio capture chunk: 50ms.')
    if (audioDelayMs) {
      log(`Audio shifted ${Math.abs(audioDelayMs)}ms ${audioDelayMs > 0 ? 'later' : 'earlier'}.`)
    }
  }

  const cmd = buildCommand({
    ffmpeg, encoder, encoderArgs,
    tvIp: settings.tvIp, tvPort: settings.tvPort,
    bitrateKbps: settings.bitrateKbps, scaleWidth: settings.scaleWidth,
    fps: settings.fps, monitor, audioDevice: audioDevice || null,
    localIp: bindIp, capture, monitorIndex, audioDelayMs,
  })

  log(`Running: ${cmd.join(' ')}`)
  startStream(
    cmd,
    log,
    (code) => win?.webContents.send('stream:ended', code),
  )
  return { ok: true, encoder, capture }
})
