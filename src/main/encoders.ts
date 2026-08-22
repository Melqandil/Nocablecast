import { runFfmpeg } from './ffmpeg.js'

/**
 * Hardware encoders to try, in order, each with the options that make it
 * behave like a real-time low-latency encoder.
 *
 * On NVENC, p1 is the fastest but lowest-quality preset. Now that capture
 * is GPU-direct there is headroom, and p4 at the same bitrate looks
 * noticeably cleaner on motion. no-scenecut stops NVENC inserting extra
 * unscheduled keyframes when the picture changes a lot -- those are data
 * bursts a Wi-Fi link can drop, which reads as a stutter. rc-lookahead 0
 * and delay 0 stop frames being held back for analysis.
 */
export const HARDWARE_ENCODERS: Array<[string, string[]]> = [
  ['h264_nvenc', ['-preset', 'p4', '-tune', 'll', '-rc', 'cbr',
                  '-rc-lookahead', '0', '-delay', '0',
                  '-no-scenecut', '1', '-forced-idr', '1']],
  ['h264_qsv', ['-preset', 'veryfast']],
  ['h264_amf', ['-usage', 'ultralowlatency']],
]

export const SOFTWARE_ENCODER: [string, string[]] =
  ['libx264', ['-preset', 'ultrafast', '-tune', 'zerolatency']]

export const ENCODER_ARGS_BY_NAME: Record<string, string[]> =
  Object.fromEntries(HARDWARE_ENCODERS)

/**
 * Stripped-back options per hardware encoder, used only if the tuned set is
 * rejected. The tuned options improve smoothness but are encoder-private,
 * so an older driver or an ffmpeg build compiled without one would fail the
 * test encode -- and silently dropping someone to slow CPU encoding over a
 * single unsupported flag would be a bad trade.
 */
export const SAFE_ENCODER_ARGS: Record<string, string[]> = {
  h264_nvenc: ['-preset', 'p4', '-tune', 'll', '-rc', 'cbr'],
  h264_qsv: ['-preset', 'veryfast'],
  h264_amf: ['-usage', 'ultralowlatency'],
}

export type EncoderPreference = 'auto' | 'cpu' | string
export type LogFn = (line: string) => void

/** Throwaway 5-frame encode. Returns why it failed, not just that it did. */
async function testEncoder(ffmpeg: string, name: string, args: string[]) {
  const res = await runFfmpeg(ffmpeg, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30',
    '-frames:v', '5', '-c:v', name, ...args, '-f', 'null', '-',
  ], 20000)
  if (res.ok) return { ok: true, detail: '' }
  const lines = res.stderr.trim().split('\n').filter(Boolean)
  return { ok: false, detail: lines[lines.length - 1] ?? '' }
}

/** Tuned options if they work, else basic options, else null. */
async function workingArgsFor(ffmpeg: string, name: string, log?: LogFn) {
  const tuned = ENCODER_ARGS_BY_NAME[name] ?? []
  const first = await testEncoder(ffmpeg, name, tuned)
  if (first.ok) return { args: tuned, detail: '' }

  const safe = SAFE_ENCODER_ARGS[name]
  if (safe && JSON.stringify(safe) !== JSON.stringify(tuned)) {
    const second = await testEncoder(ffmpeg, name, safe)
    if (second.ok) {
      log?.(`${name}: some tuning options weren't accepted -- using basic settings instead (still GPU-encoded).`)
      return { args: safe, detail: '' }
    }
    return { args: null, detail: second.detail || first.detail }
  }
  return { args: null, detail: first.detail }
}

/**
 * Picks an encoder.
 *   'auto' -- try each GPU encoder in order, fall back to software.
 *   'cpu'  -- always software, skip the GPU entirely.
 *   a name -- test only that GPU encoder; if it doesn't work here, fall back
 *             to software and say why, rather than silently using a
 *             different vendor's encoder the user didn't select.
 */
export async function detectEncoder(
  ffmpeg: string,
  preference: EncoderPreference = 'auto',
  log?: LogFn,
): Promise<[string, string[]]> {
  if (preference === 'cpu') {
    log?.('Encoder: CPU only selected -- using software encoding (libx264).')
    return SOFTWARE_ENCODER
  }

  if (preference !== 'auto' && preference in ENCODER_ARGS_BY_NAME) {
    const { args, detail } = await workingArgsFor(ffmpeg, preference, log)
    if (args) {
      log?.(`Using requested GPU encoder: ${preference}`)
      return [preference, args]
    }
    log?.(
      `Requested GPU encoder '${preference}' isn't usable on this PC${detail ? ` (${detail})` : ''}` +
      ` -- falling back to software encoding (libx264). This usually means that GPU vendor's driver` +
      ` isn't installed, there's no matching GPU in this PC, or this ffmpeg build wasn't compiled with support for it.`,
    )
    return SOFTWARE_ENCODER
  }

  for (const [name] of HARDWARE_ENCODERS) {
    const { args } = await workingArgsFor(ffmpeg, name, log)
    if (args) {
      log?.(`Hardware encoder available: ${name}`)
      return [name, args]
    }
  }
  log?.('No hardware encoder found -- will use software encoding (libx264).')
  return SOFTWARE_ENCODER
}

/**
 * Checks whether Desktop Duplication capture actually works before a live
 * stream is committed to it. It needs Windows 8+, a recent ffmpeg, and a
 * driver exposing the Desktop Duplication API, and it is unavailable in
 * some remote-desktop sessions -- so rather than guess, encode three
 * throwaway frames and see.
 */
export async function testDdagrab(
  ffmpeg: string,
  monitorIndex = 0,
): Promise<{ ok: boolean; detail: string }> {
  if (process.platform !== 'win32') return { ok: false, detail: 'not Windows' }
  const res = await runFfmpeg(ffmpeg, [
    '-hide_banner', '-loglevel', 'error',
    '-init_hw_device', 'd3d11va',
    '-filter_complex', `ddagrab=output_idx=${monitorIndex}:framerate=30`,
    '-frames:v', '3', '-f', 'null', '-',
  ], 25000)
  if (res.ok) return { ok: true, detail: '' }
  const lines = res.stderr.trim().split('\n').filter(Boolean)
  return { ok: false, detail: lines[lines.length - 1] ?? '' }
}
