export const BROWSER_PINCH_ZOOM_ENABLE_CHANNEL = 'browserPinchZoom:enable'
export const BROWSER_PINCH_ZOOM_STATE_CHANNEL = 'browserPinchZoom:state'

export const BROWSER_PINCH_ZOOM_MIN_SCALE = 1
export const BROWSER_PINCH_ZOOM_MAX_SCALE = 3

export type BrowserPinchZoomPayload = {
  scale: number
  offsetX: number
  offsetY: number
  scrollX: number
  scrollY: number
  scrollWidth: number
  scrollHeight: number
  viewportWidth: number
  viewportHeight: number
}

const PAYLOAD_KEYS: readonly (keyof BrowserPinchZoomPayload)[] = [
  'scale',
  'offsetX',
  'offsetY',
  'scrollX',
  'scrollY',
  'scrollWidth',
  'scrollHeight',
  'viewportWidth',
  'viewportHeight'
]

/** Why validated: the payload comes from the guest page's process and drives host-side styles. */
export function parseBrowserPinchZoomPayload(value: unknown): BrowserPinchZoomPayload | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const record = value as Record<string, unknown>
  const payload: Record<string, number> = {}
  for (const key of PAYLOAD_KEYS) {
    const field = record[key]
    if (typeof field !== 'number' || !Number.isFinite(field)) {
      return null
    }
    payload[key] = field
  }
  if (
    payload.scale < BROWSER_PINCH_ZOOM_MIN_SCALE ||
    payload.scale > BROWSER_PINCH_ZOOM_MAX_SCALE ||
    payload.viewportWidth < 0 ||
    payload.viewportHeight < 0 ||
    payload.scrollWidth < 0 ||
    payload.scrollHeight < 0
  ) {
    return null
  }
  // SAFETY: every key in PAYLOAD_KEYS was checked to be a finite number above.
  return payload as BrowserPinchZoomPayload
}

export type OverlayScrollbarGeometry = { length: number; offset: number }

const MIN_OVERLAY_SCROLLBAR_LENGTH = 24

/**
 * The magnified document is `content * scale` long inside a `visible` pane; its scroll position
 * on screen is `scroll * scale - offset`. Null when nothing is left to scroll.
 */
export function computeOverlayScrollbar(
  content: number,
  scale: number,
  visible: number,
  scroll: number,
  translate: number
): OverlayScrollbarGeometry | null {
  const total = content * scale
  if (total <= visible + 1) {
    return null
  }
  const length = Math.max(MIN_OVERLAY_SCROLLBAR_LENGTH, (visible * visible) / total)
  const ratio = Math.min(1, Math.max(0, (scroll * scale - translate) / (total - visible)))
  return { length, offset: (visible - length) * ratio }
}
