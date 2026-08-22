import { spawn, type ChildProcess } from 'node:child_process'
import { NO_WINDOW } from './ffmpeg.js'

export type StreamLogFn = (line: string) => void
export type StreamExitFn = (code: number | null) => void

let current: ChildProcess | null = null

export function isStreaming(): boolean {
  return current !== null && current.exitCode === null
}

/** Starts ffmpeg, relaying its output line by line. */
export function startStream(cmd: string[], onLog: StreamLogFn, onExit: StreamExitFn): void {
  if (isStreaming()) throw new Error('A stream is already running.')
  const [bin, ...args] = cmd
  const proc = spawn(bin, args, { ...NO_WINDOW })
  current = proc

  const relay = (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split(/\r?\n/)) {
      if (line.trim()) onLog(line)
    }
  }
  proc.stdout?.on('data', relay)
  proc.stderr?.on('data', relay)

  proc.on('error', (err) => onLog(`Failed to start ffmpeg: ${err.message}`))
  proc.on('close', (code) => {
    if (current === proc) current = null
    onExit(code)
  })
}

export async function stopStream(): Promise<void> {
  const dying = current
  current = null
  if (!dying || dying.exitCode !== null) return

  // SIGTERM lets ffmpeg flush and close its socket cleanly.
  await new Promise<void>((resolve) => {
    let finished = false
    let forceTimer: NodeJS.Timeout | undefined
    let failsafeTimer: NodeJS.Timeout | undefined
    const finish = () => {
      if (finished) return
      finished = true
      if (forceTimer) clearTimeout(forceTimer)
      if (failsafeTimer) clearTimeout(failsafeTimer)
      resolve()
    }
    dying.once('close', finish)
    dying.kill('SIGTERM')
    forceTimer = setTimeout(() => {
      if (dying.exitCode === null) dying.kill('SIGKILL')
    }, 3000)
    failsafeTimer = setTimeout(finish, 5000)
  })
}
