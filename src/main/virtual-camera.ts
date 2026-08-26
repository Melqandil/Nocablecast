import { app } from 'electron'
import { existsSync } from 'node:fs'
import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { join } from 'node:path'
import { release } from 'node:os'

export interface VirtualCameraStatus {
  supported: boolean
  installed: boolean
  running: boolean
  bundleAvailable: boolean
  message: string
}

let cameraProcess: ChildProcessWithoutNullStreams | null = null

function windowsBuild(): number {
  return Number.parseInt(release().split('.')[2] ?? '0', 10) || 0
}

function bundleRoot(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'virtual-camera')
    : join(app.getAppPath(), 'resources', 'virtual-camera')
}

function installRoot(): string {
  return join(process.env.ProgramFiles || 'C:\\Program Files', 'LANCAST Virtual Camera')
}

function managerPath(): string {
  return join(installRoot(), 'LANCAST.VirtualCamera.exe')
}

export function virtualCameraFramePath(): string {
  return join(process.env.ProgramData || 'C:\\ProgramData', 'LANCAST', 'phone-camera.jpg')
}

export function getVirtualCameraStatus(): VirtualCameraStatus {
  if (process.platform !== 'win32') {
    return {
      supported: false,
      installed: false,
      running: false,
      bundleAvailable: false,
      message: 'The virtual camera is available only on Windows 11.',
    }
  }
  const supported = windowsBuild() >= 22000
  const installed = existsSync(managerPath())
  const bundleAvailable = existsSync(join(bundleRoot(), 'LANCAST.VirtualCamera.exe'))
  return {
    supported,
    installed,
    running: cameraProcess !== null && cameraProcess.exitCode === null,
    bundleAvailable,
    message: !supported
      ? 'Windows 11 (build 22000 or newer) is required for the built-in virtual-camera API.'
      : !installed
        ? 'Install the LANCAST camera component once, then it will appear in camera apps.'
        : cameraProcess
          ? 'LANCAST Phone Camera is available to camera apps.'
          : 'Installed — start it after connecting the phone.',
  }
}

function runFile(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true }, (error, _stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message))
      else resolve()
    })
  })
}

export async function installVirtualCamera(): Promise<VirtualCameraStatus> {
  const status = getVirtualCameraStatus()
  if (!status.supported) throw new Error(status.message)
  const root = bundleRoot()
  const installer = join(root, 'install-virtual-camera.ps1')
  if (!existsSync(installer) || !status.bundleAvailable) {
    throw new Error('This development build does not contain the native virtual-camera component. Use the LANCAST installer from the GitHub release.')
  }
  const powerShell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  await runFile(powerShell, [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', installer,
    '-Mode', 'install', '-SourceDir', root,
  ])
  const next = getVirtualCameraStatus()
  if (!next.installed) throw new Error('The virtual-camera installation did not complete. Approve the Windows administrator prompt and try again.')
  return next
}

export async function startVirtualCamera(): Promise<VirtualCameraStatus> {
  const status = getVirtualCameraStatus()
  if (!status.supported || !status.installed) throw new Error(status.message)
  if (cameraProcess && cameraProcess.exitCode === null) return getVirtualCameraStatus()

  cameraProcess = spawn(managerPath(), ['--start'], {
    cwd: installRoot(),
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The Windows virtual camera did not start in time.')), 8000)
    const finish = (error?: Error) => {
      clearTimeout(timer)
      if (error) reject(error)
      else resolve()
    }
    cameraProcess?.stdout.on('data', (data: Buffer) => {
      if (data.toString().includes('READY')) finish()
    })
    cameraProcess?.once('error', (error) => finish(error))
    cameraProcess?.once('exit', (code) => {
      if (code !== null && code !== 0) finish(new Error(`The Windows virtual camera exited with code ${code}.`))
    })
  }).catch((error) => {
    cameraProcess?.kill()
    cameraProcess = null
    throw error
  })
  cameraProcess.once('exit', () => { cameraProcess = null })
  return getVirtualCameraStatus()
}

export async function stopVirtualCamera(): Promise<void> {
  const child = cameraProcess
  cameraProcess = null
  if (!child || child.exitCode !== null) return
  child.stdin.write('stop\n')
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill()
      resolve()
    }, 2000)
    child.once('exit', () => { clearTimeout(timer); resolve() })
  })
}
