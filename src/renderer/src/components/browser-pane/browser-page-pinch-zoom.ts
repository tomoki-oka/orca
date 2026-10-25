import {
  BROWSER_PINCH_ZOOM_ENABLE_CHANNEL,
  BROWSER_PINCH_ZOOM_STATE_CHANNEL,
  computeOverlayScrollbar,
  NO_PINCH_ZOOM,
  parseBrowserPinchZoomPayload,
  type PinchZoomTransform,
  type BrowserPinchZoomPayload
} from '../../../../shared/browser-pinch-zoom'

const SCROLLBAR_HIDE_DELAY_MS = 800

function createOverlayScrollbar(host: HTMLElement, vertical: boolean): HTMLDivElement {
  const bar = host.ownerDocument.createElement('div')
  bar.setAttribute('aria-hidden', 'true')
  bar.dataset.browserPinchZoomScrollbar = ''
  Object.assign(bar.style, {
    position: 'absolute',
    [vertical ? 'right' : 'bottom']: '2px',
    [vertical ? 'width' : 'height']: '7px',
    borderRadius: '4px',
    background: 'rgba(0, 0, 0, 0.45)',
    boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.5)',
    opacity: '0',
    transition: 'opacity 0.3s',
    pointerEvents: 'none'
  })
  host.appendChild(bar)
  return bar
}

type PinchZoomController = { setEnabled: (enabled: boolean) => void }

const controllers = new WeakMap<Electron.WebviewTag, PinchZoomController>()
const appliedTransforms = new WeakMap<Electron.WebviewTag, PinchZoomTransform>()
const changeListeners = new Set<(webview: Electron.WebviewTag) => void>()

/** The transform currently applied to a webview; host overlays use it to line up with the magnified page. */
export function getBrowserPagePinchZoom(webview: Electron.WebviewTag): PinchZoomTransform {
  return appliedTransforms.get(webview) ?? NO_PINCH_ZOOM
}

export function subscribeBrowserPagePinchZoomChange(
  listener: (webview: Electron.WebviewTag) => void
): () => void {
  changeListeners.add(listener)
  return () => changeListeners.delete(listener)
}

function publishTransform(webview: Electron.WebviewTag, transform: PinchZoomTransform): void {
  appliedTransforms.set(webview, transform)
  for (const listener of changeListeners) {
    listener(webview)
  }
}

/**
 * Mirrors the guest's pinch-zoom state onto its `<webview>`. `clip` must be the pane-sized box
 * around the guest and is made `overflow: hidden`, so the transformed guest never reaches Orca's
 * own UI. The listeners live on the webview, so they go away with it and need no teardown.
 */
export function attachBrowserPagePinchZoom(webview: Electron.WebviewTag, clip: HTMLElement): void {
  let enabled = true
  let hideTimer: ReturnType<typeof setTimeout> | undefined
  let verticalBar: HTMLDivElement | null = null
  let horizontalBar: HTMLDivElement | null = null
  clip.style.overflow = 'hidden'
  // Why: a rebuilt webview reuses its clip, and the previous guest's bars would otherwise stay behind.
  clip.querySelectorAll('[data-browser-pinch-zoom-scrollbar]').forEach((bar) => bar.remove())

  const hideBars = (): void => {
    for (const bar of [verticalBar, horizontalBar]) {
      if (bar) {
        bar.style.opacity = '0'
      }
    }
  }
  const sendEnable = (): void => {
    try {
      webview.send(BROWSER_PINCH_ZOOM_ENABLE_CHANNEL, enabled)
    } catch {
      // Why: the guest may be gone or not yet attached; the next dom-ready sends it again.
    }
  }
  const clear = (): void => {
    clearTimeout(hideTimer)
    webview.style.transformOrigin = ''
    webview.style.transform = ''
    hideBars()
    publishTransform(webview, NO_PINCH_ZOOM)
  }
  const apply = (payload: BrowserPinchZoomPayload): void => {
    if (payload.scale === 1) {
      clear()
      return
    }
    webview.style.transformOrigin = '0 0'
    webview.style.transform = `translate(${payload.offsetX}px, ${payload.offsetY}px) scale(${payload.scale})`
    publishTransform(webview, {
      scale: payload.scale,
      offsetX: payload.offsetX,
      offsetY: payload.offsetY
    })
    verticalBar ??= createOverlayScrollbar(clip, true)
    horizontalBar ??= createOverlayScrollbar(clip, false)
    const vertical = computeOverlayScrollbar(
      payload.scrollHeight,
      payload.scale,
      payload.viewportHeight,
      payload.scrollY,
      payload.offsetY
    )
    const horizontal = computeOverlayScrollbar(
      payload.scrollWidth,
      payload.scale,
      payload.viewportWidth,
      payload.scrollX,
      payload.offsetX
    )
    verticalBar.style.opacity = vertical ? '1' : '0'
    if (vertical) {
      verticalBar.style.top = `${vertical.offset}px`
      verticalBar.style.height = `${vertical.length}px`
    }
    horizontalBar.style.opacity = horizontal ? '1' : '0'
    if (horizontal) {
      horizontalBar.style.left = `${horizontal.offset}px`
      horizontalBar.style.width = `${horizontal.length}px`
    }
    clearTimeout(hideTimer)
    hideTimer = setTimeout(hideBars, SCROLLBAR_HIDE_DELAY_MS)
  }

  const onIpcMessage = (event: Event): void => {
    const message = event as Electron.IpcMessageEvent
    if (!enabled || message.channel !== BROWSER_PINCH_ZOOM_STATE_CHANNEL) {
      return
    }
    const payload = parseBrowserPinchZoomPayload(message.args[0])
    if (payload) {
      apply(payload)
    }
  }
  const onLoadCommit = (event: Event): void => {
    if ((event as Electron.LoadCommitEvent).isMainFrame) {
      clear()
      // Why: a same-document navigation keeps the guest's preload, so it must drop its state too.
      sendEnable()
    }
  }

  webview.addEventListener('dom-ready', sendEnable)
  webview.addEventListener('ipc-message', onIpcMessage)
  webview.addEventListener('load-commit', onLoadCommit)
  controllers.set(webview, {
    setEnabled: (next) => {
      if (next === enabled) {
        return
      }
      enabled = next
      clear()
      sendEnable()
    }
  })
}

/** Turns pinch zoom on or off for an attached webview, dropping any magnification. */
export function setBrowserPagePinchZoomEnabled(
  webview: Electron.WebviewTag,
  enabled: boolean
): void {
  controllers.get(webview)?.setEnabled(enabled)
}
