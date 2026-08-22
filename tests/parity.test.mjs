/**
 * Parity test: the ported TypeScript builder must produce exactly the same
 * ffmpeg arguments as the working Python version. The Python app is the
 * reference implementation -- every value in it was tuned against real
 * hardware, so any divergence here is a regression, not a refactor.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { buildCommand } from '../out-test/command.js'

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PY = join(ROOT, 'legacy', 'tv_stream_gui.py')

/**
 * The Python app in legacy/ is the reference implementation: every value in
 * it was tuned against real hardware over many rounds. This test pins the
 * TypeScript port to it exactly. It needs a Python interpreter; where none
 * exists the parity check is skipped rather than failing, and the
 * interpreter-free invariant tests in command.test.mjs still run.
 */
function findPython() {
  for (const bin of ['python3', 'python', 'py']) {
    try {
      execFileSync(bin, ['--version'], { stdio: 'ignore' })
      return bin
    } catch { /* try the next one */ }
  }
  return null
}
const PYTHON = findPython()
const SKIP = !PYTHON || !existsSync(PY)

function pythonCommand(args) {
  // The reference script is a desktop app, so it imports tkinter at module
  // load. build_command itself is a pure function with no GUI involvement, so
  // stub the GUI modules out rather than requiring a Tk-enabled interpreter
  // on every machine that runs these tests.
  const script = `
import importlib.util, sys, json, types
for name in ('tkinter', 'tkinter.ttk', 'tkinter.messagebox'):
    stub = types.ModuleType(name)
    stub.__getattr__ = lambda _n: object
    sys.modules[name] = stub
spec = importlib.util.spec_from_file_location('t', ${JSON.stringify(PY)})
m = importlib.util.module_from_spec(spec); sys.modules['t']=m; spec.loader.exec_module(m)
a = json.loads(sys.argv[1])
mon = a['monitor']
cmd = m.build_command('ffmpeg', a['encoder'], a['encoder_args'],
  a['tv_ip'], a['tv_port'], a['bitrate'], a['width'], a['fps'],
  monitor=mon, audio_device=a['audio'], local_ip=a['local_ip'],
  capture=a['capture'], monitor_index=a['monitor_index'],
  audio_delay_ms=a['audio_delay_ms'])
print(json.dumps(cmd))
`
  return JSON.parse(execFileSync(PYTHON, ['-c', script, JSON.stringify(args)], { encoding: 'utf8' }))
}

const MON = { left: 0, top: 0, width: 1920, height: 1080 }
const NVENC = ['-preset','p4','-tune','ll','-rc','cbr','-rc-lookahead','0','-delay','0','-no-scenecut','1','-forced-idr','1']
const X264 = ['-preset','ultrafast','-tune','zerolatency']

const cases = []
for (const capture of ['ddagrab', 'gdigrab']) {
  for (const audio of [null, 'CABLE Output (VB-Audio Virtual Cable)']) {
    for (const audio_delay_ms of [0, -112, 250]) {
      for (const [encoder, encoder_args] of [['h264_nvenc', NVENC], ['libx264', X264]]) {
        for (const [width, monitor] of [['1920', MON], ['1280', MON], ['1920', null]]) {
          cases.push({
            encoder, encoder_args, tv_ip: '192.168.100.3', tv_port: '1234',
            bitrate: '8000', width, fps: '60', monitor,
            audio, local_ip: '192.168.100.2', capture,
            monitor_index: 0, audio_delay_ms,
          })
        }
      }
    }
  }
}

test(`buildCommand matches Python reference across ${cases.length} configurations`, { skip: SKIP ? 'no Python interpreter available' : false }, () => {
  for (const c of cases) {
    const expected = pythonCommand(c)
    const actual = buildCommand({
      ffmpeg: 'ffmpeg', encoder: c.encoder, encoderArgs: c.encoder_args,
      tvIp: c.tv_ip, tvPort: c.tv_port, bitrateKbps: c.bitrate,
      scaleWidth: c.width, fps: c.fps, monitor: c.monitor,
      audioDevice: c.audio, localIp: c.local_ip, capture: c.capture,
      monitorIndex: c.monitor_index, audioDelayMs: c.audio_delay_ms,
    })
    assert.deepEqual(actual, expected,
      `mismatch for capture=${c.capture} audio=${!!c.audio} delay=${c.audio_delay_ms} enc=${c.encoder} width=${c.width} monitor=${!!c.monitor}\n` +
      `expected: ${expected.join(' ')}\nactual:   ${actual.join(' ')}`)
  }
})
