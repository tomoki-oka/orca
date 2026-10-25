// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import {
  BROWSER_PINCH_ZOOM_ENABLE_CHANNEL,
  BROWSER_PINCH_ZOOM_STATE_CHANNEL,
  type BrowserPinchZoomPayload
} from '../../../../shared/browser-pinch-zoom'
import {
  attachBrowserPagePinchZoom,
  getBrowserPagePinchZoom,
  setBrowserPagePinchZoomEnabled,
  subscribeBrowserPagePinchZoomChange
} from './browser-page-pinch-zoom'

const MAGNIFIED: BrowserPinchZoomPayload = {
  scale: 2,
  offsetX: -100,
  offsetY: -50,
  scrollX: 0,
  scrollY: 0,
  scrollWidth: 1000,
  scrollHeight: 4000,
  viewportWidth: 1000,
  viewportHeight: 800
}

function setup(): {
  clip: HTMLElement
  webview: Electron.WebviewTag
  send: ReturnType<typeof vi.fn>
  emit: (type: string, props?: Record<string, unknown>) => void
} {
  const clip = document.createElement('div')
  const element = document.createElement('div')
  const send = vi.fn()
  // SAFETY: the controller only touches style, send and event listeners, which this element and stub provide.
  const webview = Object.assign(element, { send }) as unknown as Electron.WebviewTag
  clip.appendChild(webview)
  attachBrowserPagePinchZoom(webview, clip)
  return {
    clip,
    webview,
    send,
    emit: (type, props) => webview.dispatchEvent(Object.assign(new Event(type), props))
  }
}

function stateMessage(payload: unknown): Record<string, unknown> {
  return { channel: BROWSER_PINCH_ZOOM_STATE_CHANNEL, args: [payload] }
}

describe('browser page pinch zoom', () => {
  it('clips the guest and enables the guest preload on dom-ready', () => {
    const { clip, emit, send } = setup()
    expect(clip.style.overflow).toBe('hidden')
    emit('dom-ready')
    expect(send).toHaveBeenCalledWith(BROWSER_PINCH_ZOOM_ENABLE_CHANNEL, true)
  })

  it('mirrors a valid state as a transform and draws scrollbars', () => {
    const { clip, emit, webview } = setup()
    emit('ipc-message', stateMessage(MAGNIFIED))
    expect(webview.style.transform).toBe('translate(-100px, -50px) scale(2)')
    expect(webview.style.transformOrigin).toBe('0 0')
    expect(clip.querySelectorAll('[data-browser-pinch-zoom-scrollbar]').length).toBe(2)
  })

  it('ignores invalid payloads and other channels', () => {
    const { emit, webview } = setup()
    emit('ipc-message', stateMessage({ ...MAGNIFIED, scale: 9 }))
    emit('ipc-message', { channel: 'other', args: [MAGNIFIED] })
    expect(webview.style.transform).toBe('')
  })

  it('removes the transform at scale 1', () => {
    const { emit, webview } = setup()
    emit('ipc-message', stateMessage(MAGNIFIED))
    emit('ipc-message', stateMessage({ ...MAGNIFIED, scale: 1, offsetX: 0, offsetY: 0 }))
    expect(webview.style.transform).toBe('')
  })

  it('resets on a main-frame commit but not on a subframe commit', () => {
    const { emit, send, webview } = setup()
    emit('ipc-message', stateMessage(MAGNIFIED))
    emit('load-commit', { isMainFrame: false })
    expect(webview.style.transform).not.toBe('')
    emit('load-commit', { isMainFrame: true })
    expect(webview.style.transform).toBe('')
    expect(send).toHaveBeenCalledWith(BROWSER_PINCH_ZOOM_ENABLE_CHANNEL, true)
  })

  it('clears the magnification, tells the guest, and ignores state while disabled', () => {
    const { emit, send, webview } = setup()
    emit('ipc-message', stateMessage(MAGNIFIED))
    setBrowserPagePinchZoomEnabled(webview, false)
    expect(webview.style.transform).toBe('')
    expect(send).toHaveBeenLastCalledWith(BROWSER_PINCH_ZOOM_ENABLE_CHANNEL, false)
    emit('ipc-message', stateMessage(MAGNIFIED))
    expect(webview.style.transform).toBe('')
    emit('dom-ready')
    expect(send).toHaveBeenLastCalledWith(BROWSER_PINCH_ZOOM_ENABLE_CHANNEL, false)
  })

  it('exposes the applied transform and notifies subscribers as it changes', () => {
    const { emit, webview } = setup()
    const listener = vi.fn()
    const unsubscribe = subscribeBrowserPagePinchZoomChange(listener)
    expect(getBrowserPagePinchZoom(webview).scale).toBe(1)
    emit('ipc-message', stateMessage(MAGNIFIED))
    expect(getBrowserPagePinchZoom(webview)).toEqual({ scale: 2, offsetX: -100, offsetY: -50 })
    expect(listener).toHaveBeenLastCalledWith(webview)
    emit('load-commit', { isMainFrame: true })
    expect(getBrowserPagePinchZoom(webview).scale).toBe(1)
    unsubscribe()
  })

  it('does not leave the previous guest scrollbars behind when its clip is reused', () => {
    const { clip, emit, webview } = setup()
    emit('ipc-message', stateMessage(MAGNIFIED))
    expect(clip.querySelectorAll('[data-browser-pinch-zoom-scrollbar]').length).toBe(2)
    attachBrowserPagePinchZoom(webview, clip)
    expect(clip.querySelectorAll('[data-browser-pinch-zoom-scrollbar]').length).toBe(0)
    emit('ipc-message', stateMessage(MAGNIFIED))
    expect(clip.querySelectorAll('[data-browser-pinch-zoom-scrollbar]').length).toBe(2)
  })
})
