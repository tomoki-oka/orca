import { useEffect, useReducer, type MutableRefObject } from 'react'
import { subscribeBrowserPagePinchZoomChange } from '../browser-page-pinch-zoom'

/** Re-renders overlays placed from the webview's rect whenever its pinch zoom moves. */
export function useBrowserPagePinchZoomRerender(
  webviewRef: MutableRefObject<Electron.WebviewTag | null>,
  active: boolean
): void {
  const [, rerender] = useReducer((count: number) => count + 1, 0)
  useEffect(() => {
    if (!active) {
      return
    }
    return subscribeBrowserPagePinchZoomChange((webview) => {
      if (webview === webviewRef.current) {
        rerender()
      }
    })
  }, [active, webviewRef])
}
