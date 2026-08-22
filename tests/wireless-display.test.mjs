import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('the renderer has an extra-monitor button with a guided Miracast workflow', async () => {
  const app = await read('src/renderer/src/App.tsx')
  assert.match(app, /Add as extra monitor/)
  assert.match(app, /<Modal isOpen=\{extraDisplayOpen\} onOpenChange=\{setExtraDisplayOpen\}>/)
  assert.match(app, /OPEN TV PICKER/)
  assert.match(app, /TV CONNECTED — USE EXTEND/)
  assert.match(app, /Requires Miracast support on both the PC and TV/)
  assert.match(app, /▶ Start/)
})

test('the preload exposes only dedicated wireless-display actions', async () => {
  const preload = await read('src/preload/index.ts')
  const api = await read('src/renderer/src/api.ts')
  assert.match(preload, /openWirelessDisplayPicker: \(\) => ipcRenderer\.invoke\('display:wireless-picker'\)/)
  assert.match(preload, /useExtendMode: \(\) => ipcRenderer\.invoke\('display:extend'\)/)
  assert.match(api, /openWirelessDisplayPicker\(\): Promise<SystemActionResult>/)
  assert.match(api, /useExtendMode\(\): Promise<SystemActionResult>/)
})

test('Windows opens wireless-display discovery and enables Extend explicitly', async () => {
  const main = await read('src/main/index.ts')
  assert.match(main, /ms-settings-connectabledevices:devicediscovery/)
  assert.match(main, /ms-settings:display/)
  assert.match(main, /DisplaySwitch\.exe/)
  assert.match(main, /execFile\(displaySwitch, \['\/extend'\]/)
  assert.match(main, /process\.platform !== 'win32'/)
})
