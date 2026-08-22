import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { app } from 'electron'

const execFileAsync = promisify(execFile)

/** Windows: don't flash a console window for every helper invocation. */
export const NO_WINDOW = process.platform === 'win32' ? { windowsHide: true } : {}

/**
 * Where ffmpeg lives.
 *
 * A packaged build ships its own ffmpeg under resources/, so an end user
 * installs the app and it works -- no PATH surgery, no separate download,
 * and it keeps working with no internet connection, which is the whole
 * point of this app. In development we fall back to a locally fetched copy
 * and then to whatever is on PATH.
 */
export function resolveFfmpeg(override?: string): string {
  if (override && override !== 'ffmpeg' && existsSync(override)) return override

  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'

  if (app.isPackaged) {
    const bundled = join(process.resourcesPath, 'ffmpeg', exe)
    if (existsSync(bundled)) return bundled
  } else {
    const here = dirname(fileURLToPath(import.meta.url))
    for (const candidate of [
      join(here, '../../resources/ffmpeg', exe),
      join(process.cwd(), 'resources/ffmpeg', exe),
    ]) {
      if (existsSync(candidate)) return candidate
    }
  }
  return override || 'ffmpeg' // fall back to PATH
}

export interface RunResult {
  ok: boolean
  stdout: string
  stderr: string
}

/** Runs ffmpeg and captures output. Never throws -- failure is a result. */
export async function runFfmpeg(
  ffmpeg: string,
  args: string[],
  timeoutMs = 20000,
): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileAsync(ffmpeg, args, {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024 * 8,
      ...NO_WINDOW,
    })
    return { ok: true, stdout, stderr }
  } catch (err: any) {
    return {
      ok: false,
      stdout: err?.stdout ?? '',
      // ffmpeg logs almost everything to stderr, including the device
      // listings we parse, so keep it even on a non-zero exit.
      stderr: err?.stderr ?? String(err?.message ?? err),
    }
  }
}

/** Confirms ffmpeg is present and runnable, returning its version line. */
export async function probeFfmpeg(ffmpeg: string): Promise<{ ok: boolean; version: string }> {
  const res = await runFfmpeg(ffmpeg, ['-hide_banner', '-version'], 10000)
  const text = res.stdout || res.stderr
  const first = text.split('\n')[0]?.trim() ?? ''
  return { ok: res.ok && /ffmpeg version/i.test(text), version: first }
}
