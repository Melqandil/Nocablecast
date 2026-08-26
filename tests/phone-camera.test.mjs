import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { WebSocket } from 'ws'
import {
  sendPhoneCameraSignal,
  startPhoneCameraServer,
  stopPhoneCameraServer,
} from '../out-test/phone-camera.js'

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

function waitForSocket(socket, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), 5000)
    socket.once(event, (...values) => { clearTimeout(timer); resolve(values) })
    socket.once('error', (error) => { clearTimeout(timer); reject(error) })
  })
}

test('phone camera serves local setup over HTTP and signals media over authenticated WSS', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lancast-phone-camera-'))
  const [setupPort, httpsPort] = await Promise.all([freePort(), freePort()])
  const signals = []
  const states = []
  const protectSecret = (value) => `protected:${Buffer.from(value).toString('base64')}`
  const unprotectSecret = (value) => Buffer.from(value.slice('protected:'.length), 'base64').toString()
  let socket
  try {
    const info = await startPhoneCameraServer({
      root,
      framePath: join(root, 'phone-camera.jpg'),
      localIp: '127.0.0.1',
      setupPort,
      httpsPort,
      protectSecret,
      unprotectSecret,
      onSignal: (message) => signals.push(message),
      onState: (state, message) => states.push({ state, message }),
    })

    assert.equal(info.setupUrl, `http://127.0.0.1:${setupPort}`)
    assert.match(info.phoneUrl, new RegExp(`^https://127\\.0\\.0\\.1:${httpsPort}/phone\\?token=`))
    assert.match(info.setupQr, /^data:image\/png;base64,/)
    assert.match(info.phoneQr, /^data:image\/png;base64,/)

    const setup = await fetch(info.setupUrl)
    assert.equal(setup.status, 200)
    assert.match(await setup.text(), /One-time secure setup/)
    const profile = await fetch(`${info.setupUrl}/lancast-camera.mobileconfig`)
    assert.equal(profile.headers.get('content-type'), 'application/x-apple-aspen-config')
    assert.match(await profile.text(), /com\.apple\.security\.root/)

    const stored = await readFile(join(root, 'phone-camera-identity.json'), 'utf8')
    assert.doesNotMatch(stored, /BEGIN (?:RSA )?PRIVATE KEY/)
    assert.match(stored, /protected:/)

    const cameraUrl = new URL(info.phoneUrl)
    socket = new WebSocket(`wss://${cameraUrl.host}/camera${cameraUrl.search}`, { rejectUnauthorized: false })
    await waitForSocket(socket, 'open')
    socket.send(JSON.stringify({ type: 'offer', description: { type: 'offer', sdp: 'test' } }))
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(signals[0].type, 'offer')
    assert.equal(states.some(({ state }) => state === 'connected'), true)
    assert.equal(states.some(({ state }) => state === 'streaming'), true)

    const received = waitForSocket(socket, 'message')
    assert.equal(sendPhoneCameraSignal({ type: 'answer', description: { type: 'answer', sdp: 'test' } }), true)
    const [data] = await received
    assert.equal(JSON.parse(data.toString()).type, 'answer')
  } finally {
    socket?.close()
    await stopPhoneCameraServer()
    await rm(root, { recursive: true, force: true })
  }
})
