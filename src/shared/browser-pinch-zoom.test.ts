import { describe, expect, it } from 'vitest'
import {
  computeOverlayScrollbar,
  parseBrowserPinchZoomPayload,
  type BrowserPinchZoomPayload
} from './browser-pinch-zoom'

const VALID: BrowserPinchZoomPayload = {
  scale: 2,
  offsetX: -100,
  offsetY: -50,
  scrollX: 0,
  scrollY: 10,
  scrollWidth: 1000,
  scrollHeight: 4000,
  viewportWidth: 1000,
  viewportHeight: 800
}

describe('parseBrowserPinchZoomPayload', () => {
  it('accepts a well-formed payload', () => {
    expect(parseBrowserPinchZoomPayload(VALID)).toEqual(VALID)
  })

  it.each([
    ['null', null],
    ['non-object', 'x'],
    ['scale below 1', { ...VALID, scale: 0.5 }],
    ['scale above 3', { ...VALID, scale: 3.5 }],
    ['NaN field', { ...VALID, offsetX: Number.NaN }],
    ['Infinity field', { ...VALID, scrollY: Number.POSITIVE_INFINITY }],
    ['string field', { ...VALID, offsetY: '5' }],
    ['missing field', { ...VALID, scrollWidth: undefined }],
    ['negative viewport', { ...VALID, viewportWidth: -1 }]
  ])('rejects %s', (_name, value) => {
    expect(parseBrowserPinchZoomPayload(value)).toBeNull()
  })
})

describe('computeOverlayScrollbar', () => {
  it('sizes the bar by visible^2 / total', () => {
    // total = 2000 * 2 = 4000, visible = 800 -> 160
    expect(computeOverlayScrollbar(2000, 2, 800, 0, 0)?.length).toBe(160)
  })

  it('enforces the minimum length', () => {
    expect(computeOverlayScrollbar(100000, 3, 800, 0, 0)?.length).toBe(24)
  })

  it('places the bar from scroll * scale - offset', () => {
    // total 4000, visible 800, length 160; position (300*2 - (-200)) = 800 of 3200 -> 0.25
    const bar = computeOverlayScrollbar(2000, 2, 800, 300, -200)
    expect(bar?.offset).toBeCloseTo((800 - 160) * 0.25)
  })

  it('reaches the end and clamps beyond it', () => {
    expect(computeOverlayScrollbar(2000, 2, 800, 0, 0)?.offset).toBe(0)
    expect(computeOverlayScrollbar(2000, 2, 800, 1200, -800)?.offset).toBe(800 - 160)
    expect(computeOverlayScrollbar(2000, 2, 800, 5000, -800)?.offset).toBe(800 - 160)
  })

  it('returns null when nothing is left to scroll', () => {
    expect(computeOverlayScrollbar(400, 2, 800, 0, 0)).toBeNull()
  })
})
