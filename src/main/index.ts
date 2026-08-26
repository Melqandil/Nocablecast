import { app, BrowserWindow, ipcMain, shell, clipboard, safeStorage } from 'electron'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, rmSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import net from 'node:net'

import { buildCommand, type MonitorRect } from './command.js'
import { resolveFfmpeg, probeFfmpeg } from './ffmpeg.js'
import { detectEncoder, testDdagrab } from './encoders.js'
import { enumerateDisplays } from './displays.js'
import { enumerateWindows, windowHandleFromSourceId } from './windows.js'
import { listAudioDevices } from './audio.js'
import { ssdpDiscover, getLocalIp } from './discovery.js'
import { scanNetwork } from './network.js'
import { loadSettings, saveSettings, DEFAULTS, type Settings } from './config.js'
import { startStream, stopStream, isStreaming } from './stream.js'
import { isLocalIpv4, validateStreamSettings } from './validation.js'
import { startHlsServer, stopHlsServer, type HlsServerInfo } from './hls-server.js'
import { initializeUpdater, registerUpdater } from './updater.js'
import {
  getPhoneCameraInfo, sendPhoneCameraSignal, startPhoneCameraServer, stopPhoneCameraServer,
  type PhoneCameraState,
} from './phone-camera.js'
import {
  getVirtualCameraStatus, installVirtualCamera, startVirtualCamera, stopVirtualCamera,
  virtualCameraFramePath,
} from './virtual-camera.js'

const here = dirname(fileURLToPath(import.meta.url))
let win: BrowserWindow | null = null
let activeHlsRoot: string | null = null
let stopping: Promise<void> | null = null
let phoneCameraState: PhoneCameraState = 'stopped'
let phoneFramePath: string | null = null
let pendingPhoneFrame: Buffer | null = null
let writingPhoneFrame = false

function log(line: string): void {
  win?.webContents.send('stream:log', line)
}

async function stopHlsOutput(): Promise<void> {
  const root = activeHlsRoot
  activeHlsRoot = null
  await stopHlsServer()
  if (root) {
    try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ }
  }
}

async function stopOutput(): Promise<void> {
  if (stopping) return stopping
  stopping = (async () => {
    await stopStream()
    await stopHlsOutput()
  })()
  try {
    await stopping
  } finally {
    stopping = null
  }
}

function protectPhoneCameraSecret(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Windows credential encryption is unavailable. LANCAST will not store a private camera certificate without it.')
  }
  return safeStorage.encryptString(value).toString('base64')
}

function unprotectPhoneCameraSecret(value: string): string {
  return safeStorage.decryptString(Buffer.from(value, 'base64'))
}

function resolvePhoneFramePath(): string {
  const shared = virtualCameraFramePath()
  try {
    mkdirSync(dirname(shared), { recursive: true })
    return shared
  } catch {
    const fallback = join(app.getPath('userData'), 'phone-camera', 'phone-camera.jpg')
    mkdirSync(dirname(fallback), { recursive: true })
    return fallback
  }
}

function queuePhoneFrame(value: unknown): void {
  if (!phoneFramePath || !(value instanceof Uint8Array) || value.byteLength < 32 || value.byteLength > 2_500_000) return
  pendingPhoneFrame = Buffer.from(value)
  if (writingPhoneFrame) return
  writingPhoneFrame = true
  void (async () => {
    while (pendingPhoneFrame && phoneFramePath) {
      const frame = pendingPhoneFrame
      const destination = phoneFramePath
      pendingPhoneFrame = null
      const temporary = `${destination}.next`
      try {
        await writeFile(temporary, frame)
        await rename(temporary, destination)
      } catch {
        // A camera reader can briefly hold the current file on Windows. A
        // direct retry is safe: the native source keeps its previous frame if
        // it happens to observe an incomplete JPEG.
        try { await writeFile(destination, frame) } catch { /* next frame retries */ }
      }
    }
    writingPhoneFrame = false
  })()
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
  initializeUpdater()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  void Promise.all([stopOutput(), stopPhoneCameraServer(), stopVirtualCamera()])
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => { void Promise.all([stopOutput(), stopPhoneCameraServer(), stopVirtualCamera()]) })

// ---------------------------------------------------------------- IPC --

ipcMain.handle('settings:load', () => loadSettings())
ipcMain.handle('settings:save', (_e, s: Partial<Settings>) => { saveSettings(s); return true })
ipcMain.handle('settings:defaults', () => DEFAULTS)

ipcMain.handle('app:copy', (_e, text: string) => { clipboard.writeText(text); return true })
ipcMain.handle('app:openExternal', (_e, url: string) => shell.openExternal(url))

ipcMain.handle('display:wireless-picker', async () => {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'Wireless display setup is available only on Windows.' }
  }
  try {
    // This opens the same Windows wireless-display discovery surface as the
    // Connect / Cast control, while leaving device approval to Windows and TV.
    await shell.openExternal('ms-settings-connectabledevices:devicediscovery')
    return { ok: true }
  } catch {
    try {
      // Older/newer Windows builds may route the discovery URI differently.
      // The documented Display page always exposes Multiple displays.
      await shell.openExternal('ms-settings:display')
      return { ok: true }
    } catch {
      return { ok: false, error: 'Windows could not open the wireless display picker.' }
    }
  }
})

ipcMain.handle('display:extend', async () => {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'Extend mode is available only on Windows.' }
  }
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  const displaySwitch = join(systemRoot, 'System32', 'DisplaySwitch.exe')
  return new Promise<{ ok: boolean; error?: string }>((resolve) => {
    execFile(displaySwitch, ['/extend'], { windowsHide: true }, (error) => {
      resolve(error
        ? { ok: false, error: 'Windows could not switch the connected displays to Extend mode.' }
        : { ok: true })
    })
  })
})

ipcMain.handle('ffmpeg:probe', async (_e, override?: string) => {
  const path = resolveFfmpeg(override)
  const { ok, version } = await probeFfmpeg(path)
  return { ok, version, path }
})

ipcMain.handle('displays:list', () => enumerateDisplays())
ipcMain.handle('windows:list', () => enumerateWindows())

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

ipcMain.handle('network:local-ip', async (_event, targetIp: string) => {
  if (!isLocalIpv4(targetIp)) return null
  return getLocalIp(targetIp.trim())
})

ipcMain.handle('stream:status', () => isStreaming())
ipcMain.handle('stream:stop', async () => { await stopOutput(); return true })

ipcMain.handle('phone-camera:start', async () => {
  if (process.platform !== 'win32') return { ok: false, error: 'Phone Camera is currently available on Windows only.' }
  try {
    phoneFramePath = resolvePhoneFramePath()
    const info = await startPhoneCameraServer({
      root: join(app.getPath('userData'), 'phone-camera'),
      framePath: phoneFramePath,
      protectSecret: protectPhoneCameraSecret,
      unprotectSecret: unprotectPhoneCameraSecret,
      onSignal: (message) => win?.webContents.send('phone-camera:signal', message),
      onState: (state, message) => {
        phoneCameraState = state
        win?.webContents.send('phone-camera:state', { state, message })
      },
    })
    return { ok: true, info }
  } catch (error) {
    phoneCameraState = 'stopped'
    phoneFramePath = null
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('phone-camera:stop', async () => {
  await stopPhoneCameraServer()
  await stopVirtualCamera()
  phoneCameraState = 'stopped'
  phoneFramePath = null
  pendingPhoneFrame = null
  return true
})

ipcMain.handle('phone-camera:status', () => ({
  state: phoneCameraState,
  info: getPhoneCameraInfo(),
  virtualCamera: getVirtualCameraStatus(),
}))
ipcMain.on('phone-camera:signal', (_event, message: unknown) => { sendPhoneCameraSignal(message) })
ipcMain.on('phone-camera:frame', (_event, frame: unknown) => { queuePhoneFrame(frame) })

ipcMain.handle('virtual-camera:install', async () => {
  try {
    const virtualCamera = await installVirtualCamera()
    // The installer creates the Frame Server-readable ProgramData directory.
    // Restart pairing so subsequent frames switch from any user-data fallback.
    return { ok: true, virtualCamera }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('virtual-camera:start', async () => {
  try {
    const virtualCamera = await startVirtualCamera()
    return { ok: true, virtualCamera }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('virtual-camera:stop', async () => { await stopVirtualCamera(); return getVirtualCameraStatus() })

registerUpdater({
  getWindow: () => win,
  beforeInstall: async () => {
    await Promise.all([stopOutput(), stopPhoneCameraServer(), stopVirtualCamera()])
  },
})

export interface StartPayload {
  settings: Settings
  monitor: MonitorRect | null
  monitorIndex: number
  windowSourceId?: string | null
  windowTitle?: string | null
}

ipcMain.handle('stream:start', async (_e, payload: StartPayload) => {
  const { settings, monitor, monitorIndex } = payload
  const validationError = validateStreamSettings(settings)
  if (validationError) return { ok: false, error: validationError }

  await stopOutput()

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

  const capturesWindow = settings.captureTarget === 'window'
  const windowHandle = capturesWindow && payload.windowSourceId
    ? windowHandleFromSourceId(payload.windowSourceId)
    : null
  if (capturesWindow && !windowHandle) {
    return { ok: false, error: 'Choose an open application window before starting.' }
  }

  // Resolve how the screen gets captured. Desktop Duplication is far faster
  // but isn't available everywhere, so unless GDI was forced we verify it
  // works before committing a live stream to it.
  let capture: 'ddagrab' | 'gdigrab'
  if (capturesWindow) {
    capture = 'gdigrab'
    log(`Capture target: ${payload.windowTitle?.trim() || 'selected application window'}.`)
    log('Capture method: GDI (required for single-window capture).')
  } else if (settings.captureMethod === 'gdigrab') {
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

  const localIp = await getLocalIp(settings.tvIp.trim())
  const bindIp = localIp && net.isIPv4(localIp) ? localIp : null
  const outputMode = settings.outputMode ?? 'udp'

  if (outputMode === 'hls' && !bindIp) {
    return { ok: false, error: 'Could not determine the LAN adapter that reaches this TV.' }
  }

  let hlsInfo: HlsServerInfo | null = null
  let hlsRoot: string | null = null
  if (outputMode === 'hls' && bindIp) {
    hlsRoot = join(app.getPath('userData'), 'hls-stream')
    try {
      rmSync(hlsRoot, { recursive: true, force: true })
      mkdirSync(hlsRoot, { recursive: true })
      activeHlsRoot = hlsRoot
      hlsInfo = await startHlsServer({
        root: hlsRoot,
        bindAddress: bindIp,
        advertisedAddress: bindIp,
        port: parseInt(settings.hlsPort, 10),
        lowLatency: settings.latencyMode === 'smooth',
      })
    } catch (error) {
      await stopHlsOutput()
      const detail = error instanceof Error ? error.message : String(error)
      return { ok: false, error: `Could not start the local HLS server: ${detail}` }
    }
  }

  log(`This PC's LAN IP: ${localIp ?? '(unknown)'}`)
  log(settings.latencyMode === 'smooth'
    ? `Latency profile: Smooth low latency (${outputMode === 'hls' ? 'TV-safe one-second HLS segments with a stable live-edge cushion' : 'immediate UDP packet flush with burst protection'}).`
    : 'Latency profile: Compatibility.')
  if (hlsInfo) {
    log(`LG browser receiver: ${hlsInfo.tvUrl}`)
    log(`SS IPTV playlist: ${hlsInfo.playlistUrl}`)
    log(`Direct HLS stream: ${hlsInfo.directUrl}`)
    log('Allow LANCAST through Windows Firewall on Private networks if the TV cannot connect.')
  } else {
    log(`Streaming to: ${settings.tvIp.trim()}:${settings.tvPort.trim()}`)
  }
  if (audioDevice) {
    log(`Audio device: ${audioDevice}`)
    log('Audio capture chunk: 50ms.')
    if (audioDelayMs) {
      log(`Audio shifted ${Math.abs(audioDelayMs)}ms ${audioDelayMs > 0 ? 'later' : 'earlier'}.`)
    }
  }

  const cmd = buildCommand({
    ffmpeg, encoder, encoderArgs,
    tvIp: settings.tvIp.trim(), tvPort: settings.tvPort.trim(),
    bitrateKbps: settings.bitrateKbps.trim(), scaleWidth: settings.scaleWidth.trim(),
    fps: settings.fps.trim(), monitor: capturesWindow ? null : monitor,
    audioDevice: audioDevice || null, localIp: bindIp, capture, monitorIndex,
    windowHandle, audioDelayMs,
    outputMode, latencyMode: settings.latencyMode,
    hlsPlaylistPath: hlsRoot ? join(hlsRoot, 'live.m3u8') : undefined,
    hlsSegmentPattern: hlsRoot ? join(hlsRoot, 'segment_%06d.ts') : undefined,
  })

  log(`Running: ${cmd.join(' ')}`)
  try {
    startStream(
      cmd,
      log,
      (code) => {
        void stopHlsOutput()
        win?.webContents.send('stream:ended', code)
      },
    )
  } catch (error) {
    await stopHlsOutput()
    const detail = error instanceof Error ? error.message : String(error)
    return { ok: false, error: `Could not start the stream: ${detail}` }
  }
  return {
    ok: true,
    encoder,
    capture,
    tvUrl: hlsInfo?.tvUrl,
    playlistUrl: hlsInfo?.playlistUrl,
    directUrl: hlsInfo?.directUrl,
  }
})
