/**
 * Visual pinch zoom for browser-tab guests. The page itself is never resized: the guest only
 * computes a scale and offset and reports them, and the embedder applies them as a CSS transform
 * on the `<webview>`, so Orca's own UI is not magnified.
 *
 * Runs in the guest's isolated world, so page script cannot observe or spoof the state.
 */

/**
 * Why the names are written out rather than imported: this module is bundled into a sandboxed
 * preload, whose `require` resolves only 'electron'. The test pins them to the shared constants.
 */
export const PRELOAD_BROWSER_PINCH_ZOOM_ENABLE_CHANNEL = 'browserPinchZoom:enable'
export const PRELOAD_BROWSER_PINCH_ZOOM_STATE_CHANNEL = 'browserPinchZoom:state'

const MIN_SCALE = 1
const MAX_SCALE = 3
const PINCH_DELTA_DIVISOR = 100
const PAN_ROOM_EPSILON = 0.5

export type PinchZoomState = { scale: number; offsetX: number; offsetY: number }
export type PinchZoomViewport = { width: number; height: number }
export type PinchZoomWheel = {
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
  deltaX: number
  deltaY: number
  clientX: number
  clientY: number
}

export const INITIAL_PINCH_ZOOM_STATE: PinchZoomState = { scale: 1, offsetX: 0, offsetY: 0 }

function clampOffset(offset: number, size: number, scale: number): number {
  return Math.min(0, Math.max(size - size * scale, offset))
}

export function clampPinchZoomState(
  state: PinchZoomState,
  viewport: PinchZoomViewport
): PinchZoomState {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, state.scale))
  return {
    scale,
    offsetX: clampOffset(state.offsetX, viewport.width, scale),
    offsetY: clampOffset(state.offsetY, viewport.height, scale)
  }
}

export type PinchZoomWheelResult = { preventDefault: boolean; state: PinchZoomState }

/** Decides whether a wheel belongs to the magnified view (consumed) or to native scrolling (left alone). */
export function reducePinchZoomWheel(
  state: PinchZoomState,
  wheel: PinchZoomWheel,
  viewport: PinchZoomViewport
): PinchZoomWheelResult {
  if (wheel.ctrlKey) {
    // Why: Ctrl combined with Shift/Alt/Meta is a different gesture, so it is left to the page.
    if (wheel.shiftKey || wheel.altKey || wheel.metaKey) {
      return { preventDefault: false, state }
    }
    // clientX/Y are pre-transform page coordinates, so the point under the fingers is
    // (client * scale + offset) on screen; keep that screen point fixed across the scale change.
    const screenX = wheel.clientX * state.scale + state.offsetX
    const screenY = wheel.clientY * state.scale + state.offsetY
    const scale = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, state.scale * Math.exp(-wheel.deltaY / PINCH_DELTA_DIVISOR))
    )
    return {
      preventDefault: true,
      state: clampPinchZoomState(
        {
          scale,
          offsetX: screenX - wheel.clientX * scale,
          offsetY: screenY - wheel.clientY * scale
        },
        viewport
      )
    }
  }
  if (state.scale === 1) {
    return { preventDefault: false, state }
  }
  const vertical = Math.abs(wheel.deltaY) >= Math.abs(wheel.deltaX)
  const delta = vertical ? wheel.deltaY : wheel.deltaX
  const offset = vertical ? state.offsetY : state.offsetX
  const minOffset = vertical
    ? viewport.height - viewport.height * state.scale
    : viewport.width - viewport.width * state.scale
  const room = delta > 0 ? offset - minOffset : -offset
  if (room < PAN_ROOM_EPSILON) {
    return { preventDefault: false, state }
  }
  return {
    preventDefault: true,
    state: clampPinchZoomState(
      {
        ...state,
        offsetX: vertical ? state.offsetX : state.offsetX - wheel.deltaX,
        offsetY: vertical ? state.offsetY - wheel.deltaY : state.offsetY
      },
      viewport
    )
  }
}

export type PinchZoomIpc = {
  on: (channel: string, listener: (event: unknown, enabled?: unknown) => void) => void
  sendToHost: (channel: string, payload: unknown) => void
}

export function installBrowserPinchZoom(ipc: PinchZoomIpc, target: Window = window): void {
  let enabled = false
  let state = INITIAL_PINCH_ZOOM_STATE
  let scrollQueued = false

  const viewport = (): PinchZoomViewport => ({
    width: target.innerWidth,
    height: target.innerHeight
  })
  const publish = (): void => {
    const root = target.document.documentElement
    ipc.sendToHost(PRELOAD_BROWSER_PINCH_ZOOM_STATE_CHANNEL, {
      scale: state.scale,
      offsetX: state.offsetX,
      offsetY: state.offsetY,
      scrollX: target.scrollX,
      scrollY: target.scrollY,
      scrollWidth: root.scrollWidth,
      scrollHeight: root.scrollHeight,
      viewportWidth: target.innerWidth,
      viewportHeight: target.innerHeight
    })
  }

  // Why: the embedder re-sends this on each main-frame commit and whenever it turns the feature
  // off (viewport emulation), so every message also drops the magnification the embedder cleared.
  ipc.on(PRELOAD_BROWSER_PINCH_ZOOM_ENABLE_CHANNEL, (_event, value) => {
    enabled = value === true
    state = INITIAL_PINCH_ZOOM_STATE
  })

  // Why capture + non-passive on window: a page that stops propagation must not hide the gesture,
  // and preventDefault is needed to keep the browser from scrolling or zooming the page itself.
  target.addEventListener(
    'wheel',
    (event) => {
      if (!enabled) {
        return
      }
      // Why: Ctrl/Cmd + mouse-wheel page zoom belongs to the main process's before-mouse-event, so a
      // Ctrl-only wheel that still reaches the page is treated as a trackpad pinch.
      const result = reducePinchZoomWheel(state, event, viewport())
      if (result.preventDefault) {
        event.preventDefault()
      }
      if (result.state !== state) {
        state = result.state
        publish()
      }
    },
    { capture: true, passive: false }
  )
  target.addEventListener(
    'scroll',
    () => {
      if (!enabled || state.scale === 1 || scrollQueued) {
        return
      }
      scrollQueued = true
      target.requestAnimationFrame(() => {
        scrollQueued = false
        publish()
      })
    },
    { passive: true }
  )
  target.addEventListener('resize', () => {
    if (!enabled || state.scale === 1) {
      return
    }
    state = clampPinchZoomState(state, viewport())
    publish()
  })
}
