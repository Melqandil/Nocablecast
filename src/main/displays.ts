import { screen } from 'electron'
import type { MonitorRect } from './command.js'

export interface DisplayInfo {
  index: number
  label: string
  rect: MonitorRect
  primary: boolean
  scaleFactor: number
}

export const ALL_MONITORS_LABEL = 'All monitors (full virtual desktop)'

/**
 * Lists displays in TRUE PHYSICAL PIXELS.
 *
 * This matters more than it looks. Windows reports scaled "logical"
 * coordinates to applications, and at any display scaling above 100%
 * (125%/150%/175% is the default on most laptops and 4K monitors) those
 * numbers are smaller than the real screen: a 1920x1080 panel at 150%
 * reports as 1280x720. ffmpeg's capture works in real pixels, so handing it
 * logical coordinates makes it grab only the top-left corner of the screen
 * -- the picture arrives on the TV cropped and zoomed in.
 *
 * Electron exposes the conversion directly via screen.dipToScreenRect,
 * which handles mixed-DPI multi-monitor setups correctly (simply
 * multiplying by scaleFactor does not, because each display can scale
 * differently and offsets compound).
 */
export function enumerateDisplays(): DisplayInfo[] {
  const primaryId = screen.getPrimaryDisplay().id
  return screen.getAllDisplays().map((d, index) => {
    let rect: MonitorRect
    try {
      const r = screen.dipToScreenRect(null, d.bounds)
      rect = { left: r.x, top: r.y, width: r.width, height: r.height }
    } catch {
      // dipToScreenRect is Windows-only; elsewhere bounds are already
      // physical for our purposes.
      rect = { left: d.bounds.x, top: d.bounds.y, width: d.bounds.width, height: d.bounds.height }
    }
    return {
      index,
      label: `Monitor ${index + 1} — ${rect.width}x${rect.height} @ (${rect.left},${rect.top})`,
      rect,
      primary: d.id === primaryId,
      scaleFactor: d.scaleFactor,
    }
  })
}
