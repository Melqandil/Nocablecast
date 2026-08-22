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
  stopStream()
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

export function stopStream(): void {
  if (current && current.exitCode === null) {
    // SIGTERM lets ffmpeg flush and close its socket cleanly.
    current.kill('SIGTERM')
    const dying = current
    setTimeout(() => { if (dying.exitCode === null) dying.kill('SIGKILL') }, 3000)
  }
  current = null
}
