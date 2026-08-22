import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('the IP and MAC results open in a modal after scanning and close after selection', async () => {
  const app = await read('src/renderer/src/App.tsx')
  assert.match(app, /setNetDevices\(devs\); setNetListOpen\(true\)/)
  assert.match(app, /<Modal isOpen=\{netListOpen\} onOpenChange=\{setNetListOpen\}>/)
  assert.match(app, /Network devices · choose the TV/)
  assert.match(app, /set\('tvIp', device\.ip\)[\s\S]*setNetListOpen\(false\)/)
})

test('the popup has labeled IP and MAC columns plus a large visible scroll region', async () => {
  const app = await read('src/renderer/src/App.tsx')
  const styles = await read('src/renderer/src/styles.css')
  assert.match(app, /IP address[\s\S]*MAC address/)
  assert.match(app, /Type an IP or MAC address/)
  assert.match(styles, /\.skeuo-device-modal\s*\{[\s\S]*width:\s*min\(94vw, 64rem\)[\s\S]*max-width:\s*min\(94vw, 64rem\)/)
  assert.match(styles, /\.device-picker-results\s*\{[\s\S]*max-height:\s*min\(52vh, 32rem\)[\s\S]*overflow-y:\s*auto/)
})
