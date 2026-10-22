import {
  BROWSER_PINCH_ZOOM_ENABLE_CHANNEL,
  BROWSER_PINCH_ZOOM_STATE_CHANNEL,
  computeOverlayScrollbar,
  parseBrowserPinchZoomPayload,
  type BrowserPinchZoomPayload
} from '../../../../shared/browser-pinch-zoom'

const SCROLLBAR_HIDE_DELAY_MS = 800

function createOverlayScrollbar(host: HTMLElement, vertical: boolean): HTMLDivElement {
  const bar = host.ownerDocument.createElement('div')
  bar.setAttribute('aria-hidden', 'true')
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

/**
 * Mirrors the guest's pinch-zoom state onto its `<webview>`. The host is `overflow: hidden`, so
 * the transformed guest is clipped to the pane and Orca's own UI is never magnified. The listeners live
 * on the webview, so they go away with it and need no teardown.
 */
export function attachBrowserClientPagePinchZoom(
  webview: Electron.WebviewTag,
  host: HTMLElement
): void {
  let hideTimer: ReturnType<typeof setTimeout> | undefined
  let verticalBar: HTMLDivElement | null = null
  let horizontalBar: HTMLDivElement | null = null

  const hideBars = (): void => {
    for (const bar of [verticalBar, horizontalBar]) {
      if (bar) {
        bar.style.opacity = '0'
      }
    }
  }
  const sendEnable = (): void => {
    try {
      webview.send(BROWSER_PINCH_ZOOM_ENABLE_CHANNEL)
    } catch {
      // Why: the guest may be gone or not yet attached; the next dom-ready sends it again.
    }
  }
  const clear = (): void => {
    clearTimeout(hideTimer)
    webview.style.transformOrigin = ''
    webview.style.transform = ''
    hideBars()
  }
  const apply = (payload: BrowserPinchZoomPayload): void => {
    if (payload.scale === 1) {
      clear()
      return
    }
    webview.style.transformOrigin = '0 0'
    webview.style.transform = `translate(${payload.offsetX}px, ${payload.offsetY}px) scale(${payload.scale})`
    verticalBar ??= createOverlayScrollbar(host, true)
    horizontalBar ??= createOverlayScrollbar(host, false)
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
    if (message.channel !== BROWSER_PINCH_ZOOM_STATE_CHANNEL) {
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
}
