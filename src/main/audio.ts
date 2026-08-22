import { runFfmpeg } from './ffmpeg.js'

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
