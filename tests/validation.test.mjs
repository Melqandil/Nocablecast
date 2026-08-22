import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isLocalIpv4, validateStreamSettings } from '../out-test/validation.js'

const valid = {
  outputMode: 'udp',
  tvIp: '192.168.1.50',
  tvPort: '1234',
  hlsPort: '8090',
  bitrateKbps: '8000',
  scaleWidth: '1920',
  fps: '60',
  audioDelayMs: '-112',
}

test('local destination validation accepts private and link-local IPv4 ranges', () => {
  for (const ip of ['10.0.0.2', '172.16.0.2', '172.31.255.254', '192.168.100.3', '169.254.1.2']) {
    assert.equal(isLocalIpv4(ip), true, ip)
  }
})

test('local destination validation rejects public, loopback, multicast, and malformed addresses', () => {
  for (const ip of ['8.8.8.8', '127.0.0.1', '224.0.0.1', '192.168.1', 'not-an-ip']) {
    assert.equal(isLocalIpv4(ip), false, ip)
  }
})

test('valid stream settings pass', () => {
  assert.equal(validateStreamSettings(valid), null)
  assert.equal(validateStreamSettings({ ...valid, tvIp: ' 192.168.1.50 ', tvPort: ' 1234 ' }), null)
  assert.equal(validateStreamSettings({ ...valid, outputMode: 'hls', hlsPort: '8090' }), null)
})

test('invalid numeric stream settings return useful errors', () => {
  assert.match(validateStreamSettings({ ...valid, tvPort: '0' }), /port/i)
  assert.match(validateStreamSettings({ ...valid, outputMode: 'hls', hlsPort: '70000' }), /HTTP port/)
  assert.match(validateStreamSettings({ ...valid, scaleWidth: '1919' }), /Width/)
  assert.match(validateStreamSettings({ ...valid, fps: '0' }), /FPS/)
  assert.match(validateStreamSettings({ ...valid, bitrateKbps: '-1' }), /Bitrate/)
  assert.match(validateStreamSettings({ ...valid, audioDelayMs: '1.5' }), /Sync/)
})
