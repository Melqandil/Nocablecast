import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('the IP and MAC picker expands after a scan and collapses after selection', async () => {
  const app = await read('src/renderer/src/App.tsx')
  assert.match(app, /setNetDevices\(devs\); setNetListOpen\(true\)/)
  assert.match(app, /aria-expanded=\{netListOpen\}/)
  assert.match(app, /set\('tvIp', device\.ip\)[\s\S]*setNetListOpen\(false\)/)
})

test('the expanded picker has labeled IP and MAC columns plus a visible scroll region', async () => {
  const app = await read('src/renderer/src/App.tsx')
  const styles = await read('src/renderer/src/styles.css')
  assert.match(app, /IP address[\s\S]*MAC address/)
  assert.match(app, /Type an IP or MAC address/)
  assert.match(styles, /\.device-picker-results\s*\{[\s\S]*max-height:\s*18rem[\s\S]*overflow-y:\s*auto/)
})
