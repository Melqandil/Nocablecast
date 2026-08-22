import { BrowserWindow, desktopCapturer } from 'electron'

export interface WindowInfo {
  /** Electron's complete media source identifier. */
  id: string
  /** Native Windows HWND, kept as text to avoid 64-bit precision loss. */
  handle: string
  title: string
}

/**
 * Extracts the native window handle from Electron's documented
 * `window:XX:YY` desktop-capture source identifier.
 */
export function windowHandleFromSourceId(sourceId: string): string | null {
  const match = /^window:([^:]+):\d+$/.exec(sourceId)
  if (!match) return null

  const handle = match[1]
  if (!/^(?:0[xX][0-9a-fA-F]+|[1-9]\d*)$/.test(handle)) return null
  try {
    if (BigInt(handle) <= 0n) return null
  } catch {
    return null
  }
  return handle
}

/**
 * Lists visible top-level app windows without generating thumbnails. The
 * current LANCAST window is omitted so selecting it cannot create a hall of
 * mirrors. A HWND is more stable than a title while streaming: browser tabs,
 * documents, and media players frequently change their title text.
 */
export async function enumerateWindows(): Promise<WindowInfo[]> {
  if (process.platform !== 'win32') return []

  const ownHandles = new Set(
    BrowserWindow.getAllWindows()
      .map((window) => windowHandleFromSourceId(window.getMediaSourceId()))
      .filter((handle): handle is string => handle !== null),
  )
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 0, height: 0 },
    fetchWindowIcons: false,
  })

  const windows: WindowInfo[] = []
  const seenHandles = new Set<string>()
  for (const source of sources) {
    const handle = windowHandleFromSourceId(source.id)
    const title = source.name.trim()
    if (!handle || ownHandles.has(handle) || !title || seenHandles.has(handle)) continue
    seenHandles.add(handle)
    windows.push({ id: source.id, handle, title })
  }

  return windows.sort((a, b) => a.title.localeCompare(b.title, undefined, {
    numeric: true,
    sensitivity: 'base',
  }))
}
