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

// FFmpeg's download page lists both providers below for Windows binaries.
// Prefer Gyan's smaller "essentials" build, with BtbN's static GPL release as
// an independent fallback. Both carry the capture devices and encoders this
// app needs (gdigrab, ddagrab, dshow, nvenc/qsv/amf).
const SOURCES = [
  {
    name: 'gyan.dev',
    url: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
  },
  {
    name: 'BtbN',
    url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n9.0-latest-win64-gpl-9.0.zip',
  },
]

if (existsSync(TARGET)) {
  console.log('ffmpeg already present, skipping download.')
  process.exit(0)
}

const TMP_ZIP = join(ROOT, 'resources', 'ffmpeg.zip')
const TMP_DIR = join(ROOT, 'resources', '_ffmpeg_tmp')

mkdirSync(dirname(TMP_ZIP), { recursive: true })
let downloadedFrom = null
let lastError = 'No download attempted.'
for (const source of SOURCES) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    console.log(`Downloading from ${source.name} (attempt ${attempt}/3): ${source.url}`)
    try {
      const res = await fetch(source.url, { redirect: 'follow' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await writeFile(TMP_ZIP, Buffer.from(await res.arrayBuffer()))
      downloadedFrom = source.name
      break
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      console.warn(`${source.name} download failed: ${lastError}`)
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 2000))
      }
    }
  }
  if (downloadedFrom) break
}
if (!downloadedFrom) {
  console.error(`All ffmpeg download sources failed. Last error: ${lastError}`)
  process.exit(1)
}
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
console.log(`ffmpeg from ${downloadedFrom} ready at ${TARGET}`)
