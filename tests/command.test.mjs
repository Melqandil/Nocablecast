/**
 * Invariants that must hold regardless of environment. These need no Python
 * interpreter, so they are the safety net that always runs in CI.
 *
 * Each one encodes a bug that actually happened, so a regression here is a
 * repeat of a real failure, not a hypothetical.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCommand, needsScaling, AUDIO_BUFFER_MS } from '../out-test/command.js'

const MON = { left: 0, top: 0, width: 1920, height: 1080 }
const NVENC = ['-preset','p4','-tune','ll','-rc','cbr','-rc-lookahead','0','-delay','0','-no-scenecut','1','-forced-idr','1']

const base = {
  ffmpeg: 'ffmpeg', encoder: 'h264_nvenc', encoderArgs: NVENC,
  tvIp: '192.168.1.5', tvPort: '1234', bitrateKbps: '8000',
  scaleWidth: '1920', fps: '60', monitor: MON, localIp: '192.168.1.2',
  monitorIndex: 0,
}

/** Slice out just the video options, so audio additions can be ignored. */
const videoOpts = (cmd) => {
  const i = cmd.indexOf('-c:v')
  const j = cmd.includes('-c:a') ? cmd.indexOf('-c:a') : cmd.indexOf('-f', i)
  return cmd.slice(i, j)
}

test('adding audio never changes a single video option', () => {
  // The bug this prevents: video collapsing to a ~1fps slideshow the moment
  // audio was enabled, because sync options were applied globally.
  for (const capture of ['ddagrab', 'gdigrab']) {
    const withoutAudio = buildCommand({ ...base, capture })
    const withAudio = buildCommand({ ...base, capture, audioDevice: 'CABLE Output', audioDelayMs: -112 })
    assert.deepEqual(videoOpts(withAudio), videoOpts(withoutAudio),
      `video options diverged when audio was added on ${capture}`)
  }
})

test('global timing options are never emitted', () => {
  const banned = ['-use_wallclock_as_timestamps', '-max_interleave_delta', '-fps_mode', '-async']
  for (const capture of ['ddagrab', 'gdigrab']) {
    for (const audioDevice of [null, 'CABLE Output']) {
      const cmd = buildCommand({ ...base, capture, audioDevice, audioDelayMs: -112 })
      for (const flag of banned) {
        assert.ok(!cmd.includes(flag), `${flag} leaked into the ${capture} command`)
      }
    }
  }
})

test('audio options never leak into a video-only command', () => {
  for (const capture of ['ddagrab', 'gdigrab']) {
    const cmd = buildCommand({ ...base, capture })
    for (const flag of ['-itsoffset', '-audio_buffer_size', '-rtbufsize', '-c:a', '-af']) {
      assert.ok(!cmd.includes(flag), `${flag} present without an audio device`)
    }
  }
})

test('audio capture chunk is small, and set before the input', () => {
  // A device-default chunk (commonly 500ms) is enough on its own to put
  // sound audibly behind picture.
  const cmd = buildCommand({ ...base, capture: 'ddagrab', audioDevice: 'CABLE Output' })
  const i = cmd.indexOf('-audio_buffer_size')
  assert.ok(i !== -1, 'audio_buffer_size missing')
  assert.equal(cmd[i + 1], String(AUDIO_BUFFER_MS))
  assert.ok(AUDIO_BUFFER_MS <= 80, 'audio buffer large enough to cause audible lag')
  assert.ok(i < cmd.indexOf('-i'), 'audio_buffer_size must precede -i to apply')
})

test('sync offset is applied before the input, in both directions', () => {
  const late = buildCommand({ ...base, capture: 'ddagrab', audioDevice: 'X', audioDelayMs: -112 })
  assert.equal(late[late.indexOf('-itsoffset') + 1], '-0.112')
  assert.ok(late.indexOf('-itsoffset') < late.indexOf('-i'))

  const early = buildCommand({ ...base, capture: 'ddagrab', audioDevice: 'X', audioDelayMs: 250 })
  assert.equal(early[early.indexOf('-itsoffset') + 1], '0.250')

  const none = buildCommand({ ...base, capture: 'ddagrab', audioDevice: 'X', audioDelayMs: 0 })
  assert.ok(!none.includes('-itsoffset'), 'a zero offset should emit nothing')
})

test('no-op rescaling is skipped', () => {
  // Rescaling 1920 to 1920 is wasted work, and at 60fps the waste is real.
  assert.equal(needsScaling('1920', MON), false)
  assert.equal(needsScaling('1280', MON), true)
  assert.equal(needsScaling('1920', null), true, 'unknown source size must still scale')

  const native = buildCommand({ ...base, capture: 'gdigrab' })
  assert.ok(!native.some((a) => String(a).includes('scale=1920')), 'no-op scale was emitted')
})

test('the GPU-direct path keeps frames on the GPU', () => {
  // Forcing a pixel format would drag frames back into system memory and
  // undo the entire point of Desktop Duplication + NVENC.
  const direct = buildCommand({ ...base, capture: 'ddagrab' })
  assert.ok(!direct.includes('-pix_fmt'), 'pix_fmt forced on the GPU-direct path')
  assert.ok(direct.includes('-init_hw_device'))

  // Downscaling or a CPU encoder must fall back to the hwdownload path.
  const scaled = buildCommand({ ...base, capture: 'ddagrab', scaleWidth: '1280' })
  assert.ok(scaled.includes('-pix_fmt'))
  assert.ok(scaled.some((a) => String(a).includes('hwdownload')))

  const cpu = buildCommand({ ...base, capture: 'ddagrab', encoder: 'libx264', encoderArgs: ['-preset','ultrafast'] })
  assert.ok(cpu.some((a) => String(a).includes('hwdownload')), 'CPU encoder needs frames in system memory')
})

test('output is bound to the local adapter and stays on the LAN', () => {
  const cmd = buildCommand({ ...base, capture: 'ddagrab' })
  const url = cmd[cmd.length - 1]
  assert.ok(url.startsWith('udp://192.168.1.5:1234'), 'unexpected destination')
  assert.ok(url.includes('localaddr=192.168.1.2'), 'stream not bound to the LAN adapter')

  const unbound = buildCommand({ ...base, capture: 'ddagrab', localIp: null })
  assert.ok(!unbound[unbound.length - 1].includes('localaddr'))
})

test('HLS output writes a short rolling playlist instead of a UDP destination', () => {
  const cmd = buildCommand({
    ...base,
    capture: 'ddagrab',
    outputMode: 'hls',
    hlsPlaylistPath: 'C:\\stream\\live.m3u8',
    hlsSegmentPattern: 'C:\\stream\\segment_%06d.ts',
  })
  assert.equal(cmd[cmd.indexOf('-f', cmd.indexOf('-c:v')) + 1], 'hls')
  assert.equal(cmd[cmd.indexOf('-hls_time') + 1], '1')
  assert.equal(cmd[cmd.indexOf('-hls_list_size') + 1], '5')
  assert.ok(cmd[cmd.indexOf('-hls_flags') + 1].includes('delete_segments'))
  assert.equal(cmd[cmd.indexOf('-hls_segment_filename') + 1], 'C:\\stream\\segment_%06d.ts')
  assert.equal(cmd.at(-1), 'C:\\stream\\live.m3u8')
  assert.ok(!cmd.some((arg) => String(arg).startsWith('udp://')))
})

test('HLS output refuses to run without writable output paths', () => {
  assert.throws(
    () => buildCommand({ ...base, outputMode: 'hls' }),
    /playlist and segment paths/,
  )
})

test('keyframes are frequent enough for quick recovery', () => {
  // Plain UDP has no retransmission, so recovery time is bounded by the
  // keyframe interval: half a second at any frame rate.
  for (const fps of ['30', '60']) {
    const cmd = buildCommand({ ...base, fps, capture: 'ddagrab' })
    assert.equal(cmd[cmd.indexOf('-g') + 1], String(parseInt(fps, 10) / 2))
  }
})

test('x264-only options are not passed to GPU encoders', () => {
  const gpu = buildCommand({ ...base, capture: 'gdigrab' })
  assert.ok(!gpu.includes('-x264-params'), 'x264 option sent to a GPU encoder')
  const cpu = buildCommand({ ...base, capture: 'gdigrab', encoder: 'libx264', encoderArgs: ['-preset','ultrafast'] })
  assert.ok(cpu.includes('-x264-params'))
})
