import { app, ipcMain, type BrowserWindow } from 'electron'
import updaterPackage from 'electron-updater'
import type { ProgressInfo, UpdateInfo } from 'electron-updater'

// electron-updater is CommonJS. Destructuring its default export keeps the
// Electron main process valid when electron-vite emits native ESM.
const { autoUpdater } = updaterPackage

export type UpdatePhase =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'error'

export interface UpdateState {
  phase: UpdatePhase
  currentVersion: string
  version?: string
  percent?: number
  message?: string
}

interface UpdaterOptions {
  getWindow: () => BrowserWindow | null
  beforeInstall: () => Promise<void>
}

let state: UpdateState = {
  phase: app.isPackaged ? 'idle' : 'disabled',
  currentVersion: app.getVersion(),
}
let getWindow: UpdaterOptions['getWindow'] = () => null
let beforeInstall: UpdaterOptions['beforeInstall'] = async () => {}
let initialized = false
let updateRequested = false
let downloadPromise: Promise<void> | null = null

function broadcast(next: UpdateState): void {
  state = next
  const window = getWindow()
  if (window && !window.isDestroyed()) {
    window.webContents.send('update:status', state)
  }
}

function idle(): UpdateState {
  return { phase: 'idle', currentVersion: app.getVersion() }
}

function failed(version?: string): UpdateState {
  return {
    phase: 'error',
    currentVersion: app.getVersion(),
    version,
    message: 'Update failed. Check the internet connection, then try again.',
  }
}

async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged || ['downloading', 'installing'].includes(state.phase)) return
  broadcast({ ...idle(), phase: 'checking' })
  try {
    await autoUpdater.checkForUpdates()
  } catch {
    // A background check must never turn a local streaming app into an error
    // screen. Only a failed user-requested download is made visible.
    if (updateRequested) broadcast(failed(state.version))
    else broadcast(idle())
  }
}

async function downloadAndInstall(): Promise<void> {
  if (!app.isPackaged) throw new Error('Updates are available only in the installed application.')
  if (downloadPromise) return downloadPromise
  if (state.phase !== 'available' && state.phase !== 'error') {
    throw new Error('No newer LANCAST release is ready to download.')
  }

  const version = state.version
  updateRequested = true
  broadcast({
    phase: 'downloading',
    currentVersion: app.getVersion(),
    version,
    percent: 0,
  })

  downloadPromise = autoUpdater.downloadUpdate()
    .then(() => undefined)
    .catch(() => {
      if (state.phase !== 'installing') broadcast(failed(version))
      throw new Error('The update could not be downloaded.')
    })
    .finally(() => { downloadPromise = null })
  return downloadPromise
}

/** Register the narrow IPC surface used by the renderer. */
export function registerUpdater(options: UpdaterOptions): void {
  getWindow = options.getWindow
  beforeInstall = options.beforeInstall

  ipcMain.handle('update:status', () => state)
  ipcMain.handle('update:install', async () => {
    try {
      await downloadAndInstall()
      return { ok: true }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'The update could not be started.',
      }
    }
  })
}

/** Start quiet release checks after the first window is ready. */
export function initializeUpdater(): void {
  if (initialized || !app.isPackaged) return
  initialized = true

  // The user chooses when an update consumes bandwidth and restarts LANCAST.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = false

  autoUpdater.on('checking-for-update', () => {
    if (!updateRequested) broadcast({ ...idle(), phase: 'checking' })
  })
  autoUpdater.on('update-not-available', () => {
    updateRequested = false
    broadcast(idle())
  })
  autoUpdater.on('update-available', (info: UpdateInfo) => {
    broadcast({
      phase: 'available',
      currentVersion: app.getVersion(),
      version: info.version,
    })
  })
  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    broadcast({
      phase: 'downloading',
      currentVersion: app.getVersion(),
      version: state.version,
      percent: Math.max(0, Math.min(100, progress.percent)),
    })
  })
  autoUpdater.on('update-downloaded', (info) => {
    if (!updateRequested) return
    broadcast({
      phase: 'installing',
      currentVersion: app.getVersion(),
      version: info.version,
      percent: 100,
      message: 'Restarting LANCAST to install the update…',
    })
    // Let the renderer paint the final state, then stop ffmpeg and its local
    // server before the NSIS installer replaces application files.
    setTimeout(() => {
      void beforeInstall().finally(() => autoUpdater.quitAndInstall(true, true))
    }, 500)
  })
  autoUpdater.on('error', () => {
    if (updateRequested) broadcast(failed(state.version))
    else broadcast(idle())
  })

  const firstCheck = setTimeout(() => { void checkForUpdates() }, 4000)
  firstCheck.unref()
  const periodicCheck = setInterval(() => { void checkForUpdates() }, 6 * 60 * 60 * 1000)
  periodicCheck.unref()
}
