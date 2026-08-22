/**
 * Downloads a Windows ffmpeg build into resources/ffmpeg/ so electron-builder
 * can bundle it into the installer.
 *
 * Bundling matters: the whole point of this app is that it works on a local
 * network with no internet, and asking a non-technical person to install
 * ffmpeg and add it to PATH is exactly the friction that stops them using it
 * at all. The binary is fetched at build time rather than committed, which
 * keeps the repository small.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, renameSync, readdirSync, statSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'resources', 'ffmpeg')
const TARGET = join(OUT_DIR, 'ffmpeg.exe')

// Gyan's "essentials" build: a static Windows binary carrying the encoders
// and capture devices this app needs (gdigrab, ddagrab, dshow, nvenc/qsv/amf).
const URL = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'

if (existsSync(TARGET)) {
  console.log('ffmpeg already present, skipping download.')
  process.exit(0)
}

const TMP_ZIP = join(ROOT, 'resources', 'ffmpeg.zip')
const TMP_DIR = join(ROOT, 'resources', '_ffmpeg_tmp')

console.log(`Downloading ${URL} ...`)
const res = await fetch(URL, { redirect: 'follow' })
if (!res.ok) {
  console.error(`Download failed: HTTP ${res.status}`)
  process.exit(1)
}
mkdirSync(dirname(TMP_ZIP), { recursive: true })
await writeFile(TMP_ZIP, Buffer.from(await res.arrayBuffer()))
console.log('Downloaded. Extracting ...')

rmSync(TMP_DIR, { recursive: true, force: true })
mkdirSync(TMP_DIR, { recursive: true })

if (process.platform === 'win32') {
  execFileSync('powershell', [
    '-NoProfile', '-Command',
    `Expand-Archive -Path "${TMP_ZIP}" -DestinationPath "${TMP_DIR}" -Force`,
  ], { stdio: 'inherit' })
} else {
  execFileSync('unzip', ['-q', TMP_ZIP, '-d', TMP_DIR], { stdio: 'inherit' })
}

/** The archive nests the binary under a versioned folder, so go find it. */
function findFfmpeg(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      const hit = findFfmpeg(full)
      if (hit) return hit
    } else if (entry.toLowerCase() === 'ffmpeg.exe') {
      return full
    }
  }
  return null
}

const found = findFfmpeg(TMP_DIR)
if (!found) {
  console.error('Could not find ffmpeg.exe inside the downloaded archive.')
  process.exit(1)
}

mkdirSync(OUT_DIR, { recursive: true })
renameSync(found, TARGET)
rmSync(TMP_DIR, { recursive: true, force: true })
rmSync(TMP_ZIP, { force: true })
console.log(`ffmpeg ready at ${TARGET}`)
