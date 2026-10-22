// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import {
  BROWSER_PINCH_ZOOM_ENABLE_CHANNEL,
  BROWSER_PINCH_ZOOM_STATE_CHANNEL
} from '../shared/browser-pinch-zoom'
import {
  clampPinchZoomState,
  INITIAL_PINCH_ZOOM_STATE,
  installBrowserPinchZoom,
  PRELOAD_BROWSER_PINCH_ZOOM_ENABLE_CHANNEL,
  PRELOAD_BROWSER_PINCH_ZOOM_STATE_CHANNEL,
  reducePinchZoomWheel,
  type PinchZoomState,
  type PinchZoomWheel
} from './browser-pinch-zoom'

const VIEWPORT = { width: 1000, height: 800 }

function wheel(overrides: Partial<PinchZoomWheel>): PinchZoomWheel {
  return { ctrlKey: false, deltaX: 0, deltaY: 0, clientX: 0, clientY: 0, ...overrides }
}

function screenPointOf(state: PinchZoomState, x: number, y: number): [number, number] {
  return [x * state.scale + state.offsetX, y * state.scale + state.offsetY]
}

describe('browser pinch zoom channels', () => {
  it('match the shared constants the embedder uses', () => {
    expect(PRELOAD_BROWSER_PINCH_ZOOM_ENABLE_CHANNEL).toBe(BROWSER_PINCH_ZOOM_ENABLE_CHANNEL)
    expect(PRELOAD_BROWSER_PINCH_ZOOM_STATE_CHANNEL).toBe(BROWSER_PINCH_ZOOM_STATE_CHANNEL)
  })
})

describe('reducePinchZoomWheel', () => {
  it('keeps the page point under the fingers fixed while pinching', () => {
    const first = reducePinchZoomWheel(
      INITIAL_PINCH_ZOOM_STATE,
      wheel({ ctrlKey: true, deltaY: -40, clientX: 300, clientY: 200 }),
      VIEWPORT
    )
    expect(first.preventDefault).toBe(true)
    expect(first.state.scale).toBeGreaterThan(1)
    const [x, y] = screenPointOf(first.state, 300, 200)
    expect(x).toBeCloseTo(300)
    expect(y).toBeCloseTo(200)

    const second = reducePinchZoomWheel(
      first.state,
      wheel({ ctrlKey: true, deltaY: -30, clientX: 500, clientY: 400 }),
      VIEWPORT
    )
    const before = screenPointOf(first.state, 500, 400)
    const after = screenPointOf(second.state, 500, 400)
    expect(after[0]).toBeCloseTo(before[0])
    expect(after[1]).toBeCloseTo(before[1])
  })

  it('clamps the scale to 1..3', () => {
    const zoomedIn = reducePinchZoomWheel(
      INITIAL_PINCH_ZOOM_STATE,
      wheel({ ctrlKey: true, deltaY: -1000, clientX: 500, clientY: 400 }),
      VIEWPORT
    )
    expect(zoomedIn.state.scale).toBe(3)
    const zoomedOut = reducePinchZoomWheel(
      zoomedIn.state,
      wheel({ ctrlKey: true, deltaY: 1000, clientX: 500, clientY: 400 }),
      VIEWPORT
    )
    expect(zoomedOut.state).toEqual(INITIAL_PINCH_ZOOM_STATE)
  })

  it('keeps the magnified view inside the pane', () => {
    const { state } = reducePinchZoomWheel(
      INITIAL_PINCH_ZOOM_STATE,
      wheel({ ctrlKey: true, deltaY: -1000, clientX: 1000, clientY: 800 }),
      VIEWPORT
    )
    expect(state.offsetX).toBe(VIEWPORT.width - VIEWPORT.width * 3)
    expect(state.offsetY).toBe(VIEWPORT.height - VIEWPORT.height * 3)
  })

  it('leaves plain wheels to the browser when not magnified', () => {
    const result = reducePinchZoomWheel(INITIAL_PINCH_ZOOM_STATE, wheel({ deltaY: 50 }), VIEWPORT)
    expect(result.preventDefault).toBe(false)
    expect(result.state).toBe(INITIAL_PINCH_ZOOM_STATE)
  })

  describe('while magnified', () => {
    const magnified: PinchZoomState = { scale: 2, offsetX: -500, offsetY: -400 }

    it('pans along the dominant axis and consumes the wheel', () => {
      const vertical = reducePinchZoomWheel(magnified, wheel({ deltaX: 5, deltaY: 30 }), VIEWPORT)
      expect(vertical.preventDefault).toBe(true)
      expect(vertical.state).toEqual({ scale: 2, offsetX: -500, offsetY: -430 })

      const horizontal = reducePinchZoomWheel(
        magnified,
        wheel({ deltaX: -40, deltaY: 10 }),
        VIEWPORT
      )
      expect(horizontal.preventDefault).toBe(true)
      expect(horizontal.state).toEqual({ scale: 2, offsetX: -460, offsetY: -400 })
    })

    it('treats equal deltas as vertical', () => {
      const result = reducePinchZoomWheel(magnified, wheel({ deltaX: 20, deltaY: 20 }), VIEWPORT)
      expect(result.state.offsetX).toBe(-500)
      expect(result.state.offsetY).toBe(-420)
    })

    it('consumes up to the edge, then hands the wheel back', () => {
      const nearBottom: PinchZoomState = { scale: 2, offsetX: -500, offsetY: -795 }
      const last = reducePinchZoomWheel(nearBottom, wheel({ deltaY: 30 }), VIEWPORT)
      expect(last.preventDefault).toBe(true)
      expect(last.state.offsetY).toBe(-800)

      const atBottom = reducePinchZoomWheel(last.state, wheel({ deltaY: 30 }), VIEWPORT)
      expect(atBottom.preventDefault).toBe(false)
      expect(atBottom.state).toBe(last.state)

      const atTop: PinchZoomState = { scale: 2, offsetX: 0, offsetY: 0 }
      expect(reducePinchZoomWheel(atTop, wheel({ deltaY: -30 }), VIEWPORT).preventDefault).toBe(
        false
      )
      expect(reducePinchZoomWheel(atTop, wheel({ deltaY: 30 }), VIEWPORT).preventDefault).toBe(true)
    })

    it('hands back based on the dominant axis only', () => {
      const atLeftEdgeBottomFree: PinchZoomState = { scale: 2, offsetX: 0, offsetY: -400 }
      const result = reducePinchZoomWheel(
        atLeftEdgeBottomFree,
        wheel({ deltaX: -40, deltaY: 10 }),
        VIEWPORT
      )
      expect(result.preventDefault).toBe(false)
    })
  })
})

describe('clampPinchZoomState', () => {
  it('re-clamps the offset when the viewport shrinks', () => {
    const state: PinchZoomState = { scale: 2, offsetX: -1000, offsetY: -800 }
    expect(clampPinchZoomState(state, { width: 600, height: 500 })).toEqual({
      scale: 2,
      offsetX: -600,
      offsetY: -500
    })
  })
})

describe('installBrowserPinchZoom', () => {
  function install(): {
    enable: () => void
    sendToHost: ReturnType<typeof vi.fn>
  } {
    const listeners = new Map<string, () => void>()
    const sendToHost = vi.fn()
    installBrowserPinchZoom({
      on: (channel, listener) => listeners.set(channel, listener),
      sendToHost
    })
    return {
      enable: () => listeners.get(PRELOAD_BROWSER_PINCH_ZOOM_ENABLE_CHANNEL)?.(),
      sendToHost
    }
  }
  // Why: happy-dom's WheelEvent drops ctrlKey and the client coordinates from its init dictionary.
  function dispatchWheel(init: Partial<PinchZoomWheel>): Event {
    const event = new Event('wheel', { cancelable: true, bubbles: true })
    Object.assign(event, { ctrlKey: false, deltaX: 0, deltaY: 0, clientX: 0, clientY: 0, ...init })
    document.body.dispatchEvent(event)
    return event
  }

  it('takes nothing until the embedder enables it', () => {
    const { sendToHost } = install()
    const event = dispatchWheel({ ctrlKey: true, deltaY: -50, clientX: 10, clientY: 10 })
    expect(event.defaultPrevented).toBe(false)
    expect(sendToHost).not.toHaveBeenCalled()
  })

  it('consumes a pinch once enabled and reports the new state to the host', () => {
    const { enable, sendToHost } = install()
    enable()
    const event = dispatchWheel({ ctrlKey: true, deltaY: -50, clientX: 10, clientY: 10 })
    expect(event.defaultPrevented).toBe(true)
    expect(sendToHost).toHaveBeenCalledTimes(1)
    const [channel, payload] = sendToHost.mock.calls[0]
    expect(channel).toBe(PRELOAD_BROWSER_PINCH_ZOOM_STATE_CHANNEL)
    expect(payload.scale).toBeGreaterThan(1)
    expect(payload.viewportWidth).toBe(window.innerWidth)
  })

  it('still sees a pinch the page stops from propagating', () => {
    const { enable, sendToHost } = install()
    enable()
    document.body.addEventListener('wheel', (e) => e.stopPropagation())
    dispatchWheel({ ctrlKey: true, deltaY: -50 })
    expect(sendToHost).toHaveBeenCalled()
  })
})
