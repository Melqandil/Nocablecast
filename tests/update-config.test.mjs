import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('packaged builds point the updater at the public GitHub repository', async () => {
  const builder = await read('electron-builder.yml')
  assert.match(builder, /provider:\s*github/)
  assert.match(builder, /owner:\s*Melqandil/)
  assert.match(builder, /repo:\s*Nocablecast/)
})

test('release workflow publishes every file required by electron-updater', async () => {
  const workflow = await read('.github/workflows/release.yml')
  assert.match(workflow, /release\/\*\.exe\.blockmap/)
  assert.match(workflow, /release\/latest\.yml/)
})

test('electron-updater is a production dependency', async () => {
  const pkg = JSON.parse(await read('package.json'))
  assert.match(pkg.dependencies?.['electron-updater'] ?? '', /^\^6\./)
  assert.equal(pkg.devDependencies?.['electron-updater'], undefined)
})

test('updates wait for a click, then install and relaunch without another wizard', async () => {
  const updater = await read('src/main/updater.ts')
  assert.match(updater, /autoUpdater\.autoDownload\s*=\s*false/)
  assert.match(updater, /autoUpdater\.quitAndInstall\(true, true\)/)
})
