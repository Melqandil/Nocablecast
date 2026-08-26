import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'

test('blocked Windows audio capture falls back to a playable video-only stream', async () => {
  const audio = await readFile('src/main/audio.ts', 'utf8')
  const main = await readFile('src/main/index.ts', 'utf8')
  const stream = await readFile('src/main/stream.ts', 'utf8')
  const preload = await readFile('src/preload/index.ts', 'utf8')

  assert.match(audio, /testAudioCapture/)
  assert.match(audio, /-f', 'dshow'/)
  assert.match(main, /Continuing with video only so the TV does not remain buffering/)
  assert.match(main, /audioDevice: null/)
  assert.match(main, /stream:audio-fallback/)
  assert.match(stream, /unexpected/)
  assert.match(preload, /stream:audio-fallback/)
})
