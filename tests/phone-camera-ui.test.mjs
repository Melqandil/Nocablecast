import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('renderer exposes phone pairing, preview, and virtual-camera controls', async () => {
  const app = await readFile('src/renderer/src/App.tsx', 'utf8')
  const preload = await readFile('src/preload/index.ts', 'utf8')
  const builder = await readFile('electron-builder.yml', 'utf8')
  const release = await readFile('.github/workflows/release.yml', 'utf8')

  assert.match(app, /Use phone as camera/)
  assert.match(app, /First time on this phone/)
  assert.match(app, /START VIRTUAL CAMERA/)
  assert.match(app, /sendPhoneCameraFrame/)
  assert.match(preload, /phone-camera:start/)
  assert.match(preload, /virtual-camera:install/)
  assert.match(builder, /resources\/virtual-camera/)
  assert.match(release, /build-virtual-camera\.ps1/)
})
