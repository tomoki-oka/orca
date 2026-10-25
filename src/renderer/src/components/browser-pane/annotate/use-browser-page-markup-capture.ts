import { useCallback, type MutableRefObject } from 'react'
import { removePinchZoomFromRect } from '../../../../../shared/browser-pinch-zoom'
import { getBrowserPagePinchZoom } from '../browser-page-pinch-zoom'
import { deliverMarkupToClipboard } from './markup-clipboard-delivery'
import {
  useMarkupMode,
  type MarkupCaptureContext,
  type MarkupModeController
} from './useMarkupMode'

export function useBrowserPageMarkupCapture(
  webviewRef: MutableRefObject<Electron.WebviewTag | null>
): MarkupModeController {
  return useMarkupMode({
    getCaptureContext: useCallback((): MarkupCaptureContext | null => {
      const webview = webviewRef.current
      if (!webview) {
        return null
      }
      // Why: capturePage returns the guest's own unmagnified frame (as DevTools does under pinch zoom), so size it by the unmagnified box.
      const rect = removePinchZoomFromRect(
        webview.getBoundingClientRect(),
        getBrowserPagePinchZoom(webview)
      )
      if (rect.width <= 0 || rect.height <= 0) {
        return null
      }
      return {
        source: { kind: 'webview', webview },
        cssWidth: rect.width,
        cssHeight: rect.height,
        outputScale: window.devicePixelRatio || 1
      }
    }, [webviewRef]),
    onDeliver: deliverMarkupToClipboard
  })
}
