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
  assert.match(app, /SECURE FALLBACK/)
  assert.match(preload, /phone-camera:start/)
  assert.match(preload, /phone-camera:jpeg/)
  assert.match(preload, /virtual-camera:install/)
  assert.match(builder, /resources\/virtual-camera/)
  assert.match(release, /build-virtual-camera\.ps1/)
})

/**
 * A peer connection reporting 'connected' only means ICE validated a
 * candidate pair -- media can still never arrive. Tearing the JPEG fallback
 * down at that point, or on ontrack, leaves the preview permanently black
 * while the UI claims to be live. The fallback may only be dropped once a
 * frame has actually been decoded.
 */
test('the phone preview only drops the fallback once real video is decoded', async () => {
  const app = await readFile('src/renderer/src/App.tsx', 'utf8')
  const camera = await readFile('src/main/phone-camera.ts', 'utf8')

  const ontrack = app.slice(app.indexOf('peer.ontrack'), app.indexOf('peer.onconnectionstatechange'))
  assert.ok(ontrack.length > 0, 'expected an ontrack handler')
  assert.doesNotMatch(ontrack, /setPhoneFallbackActive\(false\)/,
    'ontrack fires before media arrives, so it must not hide the fallback')
  assert.doesNotMatch(ontrack, /setPhonePreviewReady\(true\)/,
    'play() resolves on an empty stream, so it must not mark the preview ready')
  assert.match(ontrack, /watchForPhoneVideo/)

  // The fallback is dropped, and 'streaming' claimed, only from the frame watcher.
  assert.match(app, /requestVideoFrameCallback/)
  assert.match(app, /media-confirmed/)
  assert.match(app, /resume-fallback/)

  // The phone honours both sides of that handshake.
  assert.match(camera, /message\.type==='media-confirmed'/)
  assert.match(camera, /message\.type==='resume-fallback'/)

  // The phone's own pump must not stop itself the moment ICE connects.
  const pump = camera.slice(camera.indexOf('function pump()'), camera.indexOf('pump();}'))
  assert.doesNotMatch(pump, /connectionState==='connected'/,
    'only the PC, which can see the decoded frames, may stop the fallback')

  // media-connected alone must not be promoted to 'streaming'.
  assert.doesNotMatch(camera, /'media-connected'\) options\.onState\('streaming'/)
})
