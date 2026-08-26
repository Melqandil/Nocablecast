import { runFfmpeg } from './ffmpeg.js'

export interface AudioCaptureCheck {
  ok: boolean
  detail: string
}

/**
 * Opens the selected DirectShow input briefly before a live stream starts.
 * Windows classifies every DirectShow capture source (including Stereo Mix
 * and virtual loopback cables) under its microphone privacy switch. Device
 * enumeration can still succeed when actual capture is blocked, so opening
 * it is the only reliable preflight.
 */
export async function testAudioCapture(ffmpeg: string, device: string): Promise<AudioCaptureCheck> {
  const result = await runFfmpeg(ffmpeg, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'dshow', '-audio_buffer_size', '50', '-i', `audio=${device}`,
    '-t', '0.35', '-map', '0:a:0', '-f', 'null', '-',
  ], 8000)

  const detail = result.stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-2)
    .join(' ')

  return { ok: result.ok, detail }
}

/**
 * Lists DirectShow audio devices ffmpeg can see.
 *
 * Different ffmpeg builds format `-list_devices` output differently, and
 * this bit them once already: some print section headers ("DirectShow audio
 * devices") followed by plain quoted names, while others tag each device
 * inline on its own line, e.g. `"Stereo Mix (Realtek(R) Audio)" (audio)`,
 * with no headers at all. A parser written for one format silently returns
 * zero devices on the other, which looks identical to "you have no audio
 * devices" and sends you chasing the wrong problem. Both are handled.
 *
 * The raw output is returned too, so a zero-result case stays diagnosable
 * (e.g. Windows blocking desktop apps from seeing recording devices, which
 * also produces an empty list).
 */
export async function listAudioDevices(
  ffmpeg: string,
): Promise<{ devices: string[]; raw: string }> {
  const res = await runFfmpeg(
    ffmpeg,
    ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'],
    20000,
  )
  const output = res.stderr // ffmpeg logs device listings to stderr
  const devices: string[] = []
  let inAudioSection = false

  for (const line of output.split('\n')) {
    if (line.includes('DirectShow audio devices')) { inAudioSection = true; continue }
    if (line.includes('DirectShow video devices')) { inAudioSection = false; continue }
    if (line.includes('Alternative name')) continue

    const inline = line.match(/"([^"]+)"\s*\(audio\)\s*$/)
    if (inline) {
      if (!devices.includes(inline[1])) devices.push(inline[1])
      continue
    }
    if (inAudioSection) {
      const m = line.match(/"([^"]+)"/)
      if (m && !devices.includes(m[1])) devices.push(m[1])
    }
  }
  return { devices, raw: output }
}
