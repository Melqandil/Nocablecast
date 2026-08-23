/**
 * The ffmpeg command builder.
 *
 * This is the heart of the app and the part that took the most iteration to
 * get right, so the reasoning is written down rather than left implicit.
 */

/**
 * How large a chunk of audio DirectShow hands over at a time, in ms.
 *
 * This is the dominant source of audio latency in the pipeline: the device
 * cannot deliver anything until a chunk is full, so chunk size is a latency
 * floor. ffmpeg otherwise leaves this at the device default, commonly 500ms
 * -- enough on its own to put sound audibly behind picture. 50ms is low
 * enough to be imperceptible while staying above the point where virtual
 * audio cables start glitching. Raise to 80 or 120 if audio crackles.
 */
export const AUDIO_BUFFER_MS = 50

export interface MonitorRect {
  left: number
  top: number
  width: number
  height: number
}

export interface BuildCommandOptions {
  ffmpeg: string
  encoder: string
  encoderArgs: string[]
  tvIp: string
  tvPort: string
  bitrateKbps: string
  scaleWidth: string
  fps: string
  /** Physical-pixel rect of the screen to capture, or null for everything. */
  monitor?: MonitorRect | null
  /** DirectShow audio device name, or null/empty for video-only. */
  audioDevice?: string | null
  /** This PC's LAN IP, bound explicitly so the stream provably stays local. */
  localIp?: string | null
  capture?: 'gdigrab' | 'ddagrab'
  /** Which display ddagrab should capture (it selects by index, not rect). */
  monitorIndex?: number | null
  /** Native Windows HWND. When set, gdigrab captures only this window. */
  windowHandle?: string | null
  /** Lip-sync correction in ms. Negative pulls audio earlier. */
  audioDelayMs?: number
  outputMode?: 'udp' | 'hls'
  /** Smooth lowers transport latency; compatibility preserves the older conservative output. */
  latencyMode?: 'smooth' | 'compatibility'
  /** Writable paths used only when outputMode is hls. */
  hlsPlaylistPath?: string
  hlsSegmentPattern?: string
}

/**
 * True when the requested output width actually differs from what is being
 * captured. Scaling 1920 to 1920 is pure wasted work, and at 60fps that
 * waste is significant.
 */
export function needsScaling(scaleWidth: string, monitor?: MonitorRect | null): boolean {
  if (!monitor) return true // unknown source size -- scale to be safe
  const want = parseInt(scaleWidth, 10)
  if (!Number.isFinite(want)) return true
  return want !== monitor.width
}

/**
 * The video encoding options. Deliberately identical regardless of whether
 * audio is included -- see the design rule on buildCommand.
 */
function videoEncodeArgs(
  encoder: string,
  encoderArgs: string[],
  rate: number,
  bufsize: number,
  gop: number,
  gpuDirect: boolean,
): string[] {
  const args = [
    '-c:v', encoder, ...encoderArgs,
    '-g', String(gop), '-bf', '0',
    '-b:v', `${rate}k`,
    '-maxrate', `${rate}k`,
    '-bufsize', `${bufsize}k`,
  ]
  if (!gpuDirect) {
    // With frames in system memory we pin the pixel format explicitly. On
    // the GPU-direct path frames never leave the GPU, so forcing a pixel
    // format here would drag them back into system memory and undo the
    // entire point of that path.
    args.push('-pix_fmt', 'yuv420p')
  }
  if (encoder === 'libx264') {
    // Resend stream headers with every keyframe so a TV joining late (or
    // recovering from a dropped packet) can start decoding at the next
    // keyframe. Only x264 understands this option.
    args.push('-x264-params', 'repeat-headers=1')
  }
  return args
}

/**
 * Filter chain for Desktop Duplication capture.
 *
 * ddagrab is a *source* filter: it produces frames rather than consuming an
 * -i input, and hands them over as GPU (d3d11) frames. If the encoder can
 * take GPU frames directly and no resizing is needed, they stay on the GPU
 * end to end -- capture, encode, done, with the CPU barely involved.
 * Otherwise they are pulled back into system memory to resize and/or feed a
 * CPU encoder.
 */
export function buildDdagrabFilter(
  fps: string,
  monitorIndex: number | null | undefined,
  scaleWidth: string,
  monitor: MonitorRect | null | undefined,
  gpuDirect: boolean,
): string {
  const idx = monitorIndex ?? 0
  let chain = `ddagrab=output_idx=${idx}:framerate=${fps}:draw_mouse=1`
  if (gpuDirect) return `${chain}[v]`
  chain += ',hwdownload,format=bgra'
  if (needsScaling(scaleWidth, monitor)) {
    chain += `,scale=${scaleWidth}:-2:flags=fast_bilinear`
  }
  return `${chain},format=yuv420p[v]`
}

/**
 * Builds the full ffmpeg argument list.
 *
 * DESIGN RULE, learned the hard way: the video half of this command is
 * byte-for-byte identical whether or not audio is included. Adding audio
 * only ever appends an input and the audio codec options -- it never
 * changes a single video option.
 *
 * Earlier versions tried to fix A/V sync with global timestamp and
 * frame-pacing options (-use_wallclock_as_timestamps, -max_interleave_delta,
 * -fps_mode, -async). Those act on the *video* stream too and throttled it
 * to a ~1fps slideshow the moment a second stream existed. Audio drift is
 * corrected purely on the audio side with aresample, which cannot slow video
 * down, and constant offset with -itsoffset. If sync needs attention again,
 * fix it on the audio side -- do not reintroduce global timing options.
 */
export function buildCommand(opts: BuildCommandOptions): string[] {
  const {
    ffmpeg, encoder, encoderArgs, tvIp, tvPort, bitrateKbps, scaleWidth, fps,
    monitor = null, audioDevice = null, localIp = null,
    capture = 'gdigrab', monitorIndex = null, windowHandle = null, audioDelayMs = 0,
    outputMode = 'udp', latencyMode = 'compatibility', hlsPlaylistPath, hlsSegmentPattern,
  } = opts
  const smoothLatency = latencyMode === 'smooth'

  // Two keyframes per second bounds UDP recovery and lets one-second HLS
  // segments close exactly on an IDR without an unnecessarily dense GOP.
  const gop = Math.max(1, Math.floor(parseInt(fps, 10) / 2))

  // A bitrate ceiling plus a full second of rate-control buffer. A tighter
  // window forces the encoder to dump quality on busy frames, which looks
  // like the picture pulsing between crisp and blocky.
  const rate = parseInt(bitrateKbps, 10)
  const bufsize = Math.max(1, rate)

  const useDda = capture === 'ddagrab'
  if (windowHandle && !/^(?:0[xX][0-9a-fA-F]+|[1-9]\d*)$/.test(windowHandle)) {
    throw new Error('Invalid window handle.')
  }
  if (windowHandle && useDda) {
    throw new Error('Single-window capture requires GDI capture.')
  }
  // A persisted monitor rect is irrelevant when the source is a window. Its
  // size comes from the HWND and can change while the app is running.
  const sourceMonitor = windowHandle ? null : monitor
  // nvenc can consume GPU frames directly; the others cannot. Combined with
  // "no resize needed", that unlocks a fully on-GPU pipeline.
  const gpuDirect = useDda && encoder === 'h264_nvenc' && !needsScaling(scaleWidth, sourceMonitor)

  const cmd: string[] = [ffmpeg, '-hide_banner', '-loglevel', 'warning']

  let audioInput: string[] = []
  if (audioDevice) {
    audioInput = []
    if (audioDelayMs) {
      // Must precede -i to apply to that input.
      audioInput.push('-itsoffset', (audioDelayMs / 1000).toFixed(3))
    }
    audioInput.push(
      '-f', 'dshow',
      '-thread_queue_size', '1024',
      '-audio_buffer_size', String(AUDIO_BUFFER_MS),
      // A cap, not a target. Deliberately not huge: if the pipeline ever
      // fell behind, an oversized cap would let audio queue into a growing
      // delay instead of failing fast and visibly.
      '-rtbufsize', '16M',
      '-i', `audio=${audioDevice}`,
    )
  }

  if (useDda) {
    cmd.push('-init_hw_device', 'd3d11va')
    // ddagrab produces video from a filter, so audio (when present) is
    // input 0.
    cmd.push(...audioInput)
    cmd.push('-filter_complex', buildDdagrabFilter(fps, monitorIndex, scaleWidth, sourceMonitor, gpuDirect))
    cmd.push('-map', '[v]')
    if (audioDevice) cmd.push('-map', '0:a')
    cmd.push(...videoEncodeArgs(encoder, encoderArgs, rate, bufsize, gop, gpuDirect))
  } else {
    const videoInput = [
      '-f', 'gdigrab',
      '-framerate', String(fps),
      // Room for the capture thread so a stall elsewhere in the pipeline
      // doesn't cost captured frames.
      '-thread_queue_size', '1024',
    ]
    if (sourceMonitor) {
      videoInput.push(
        '-offset_x', String(sourceMonitor.left),
        '-offset_y', String(sourceMonitor.top),
        '-video_size', `${sourceMonitor.width}x${sourceMonitor.height}`,
      )
    }
    videoInput.push('-i', windowHandle ? `hwnd=${windowHandle}` : 'desktop')
    cmd.push(...videoInput, ...audioInput)
    if (audioDevice) cmd.push('-map', '0:v', '-map', '1:a')
    if (needsScaling(scaleWidth, sourceMonitor)) {
      cmd.push('-vf', `scale=${scaleWidth}:-2:flags=fast_bilinear`)
    }
    cmd.push(...videoEncodeArgs(encoder, encoderArgs, rate, bufsize, gop, gpuDirect))
  }

  if (audioDevice) {
    cmd.push(
      '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', '48000',
      // Corrects drift on the AUDIO stream only, by stretching or padding
      // samples. Video is never touched, so this cannot cause the
      // frame-rate collapse the old global options did.
      '-af', 'aresample=async=1000',
    )
  }

  if (outputMode === 'hls') {
    if (!hlsPlaylistPath || !hlsSegmentPattern) {
      throw new Error('HLS output requires playlist and segment paths.')
    }
    if (smoothLatency) {
      // The HLS player receives only complete segments. Per-packet flushing
      // makes each completed segment visible without another output batch.
      cmd.push('-flush_packets', '1')
    }
    cmd.push(
      '-f', 'hls',
      '-hls_time', '1',
      // Six seconds gives TV-native players their normal three-target-duration
      // safety cushion without increasing the chosen live-edge offset.
      '-hls_list_size', smoothLatency ? '6' : '5',
      // Keep recently removed segments on disk long enough for a slower TV
      // request that was made just before the rolling playlist advanced.
      ...(smoothLatency ? ['-hls_delete_threshold', '3'] : []),
      '-hls_segment_type', 'mpegts',
      // Keep the live manifest deliberately conservative for TV browsers.
      // In particular, LG webOS rejects EXT-X-INDEPENDENT-SEGMENTS and is
      // unreliable around the discontinuity tag produced by append_list.
      // This combination produces a simple HLS v3 rolling playlist.
      '-hls_flags', 'delete_segments+omit_endlist+temp_file',
      '-hls_segment_filename', hlsSegmentPattern,
      hlsPlaylistPath,
    )
  } else {
    let udpUrl = `udp://${tvIp}:${tvPort}?pkt_size=1316`
    if (smoothLatency) udpUrl += '&buffer_size=65536&connect=1'
    if (localIp) udpUrl += `&localaddr=${localIp}`
    // muxdelay/muxpreload 0 stop the TS muxer pre-buffering before it starts
    // sending -- shaves startup latency off a live stream.
    if (smoothLatency) {
      // Direct AVIO plus per-packet flush prevents ffmpeg from accumulating
      // an extra output batch. A modest 64 KiB socket buffer absorbs normal
      // frame bursts without creating a long latency queue. Repeated MPEG-TS
      // headers let a receiver recover cleanly at the next keyframe.
      cmd.push('-avioflags', 'direct', '-flush_packets', '1')
    }
    cmd.push(
      '-f', 'mpegts',
      ...(smoothLatency ? ['-mpegts_flags', '+resend_headers'] : []),
      '-muxdelay', '0', '-muxpreload', '0', udpUrl,
    )
  }
  return cmd
}
