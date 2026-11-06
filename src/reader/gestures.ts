import type { ReaderSettings } from '../types'

export function bindReadingGestures(target: Document | HTMLElement, options: {
  settings: () => ReaderSettings
  next: () => void
  prev: () => void
  toggle: () => void
  nativeSwipe?: boolean
  selected?: () => boolean
  canSwipe?: (dx: number) => boolean
}) {
  const abort = new AbortController()
  const signal = abort.signal
  const doc = target.nodeType === 9 ? target as Document : undefined
  let start: { x: number; y: number; time: number } | null = null
  let moved = false, multi = false, suppressClickUntil = 0
  let swipeLeft = true, swipeRight = true
  const selected = () => options.selected?.() || !!(doc ? doc.getSelection()?.toString() : window.getSelection()?.toString())
  target.addEventListener('touchstart', ((e: TouchEvent) => {
    if (e.touches.length > 1) multi = true
    // Keep a pinch marked until every finger has lifted.
    if (e.touches.length === 1 && !multi) {
      swipeLeft = options.canSwipe?.(-1) ?? true
      swipeRight = options.canSwipe?.(1) ?? true
    }
    moved = false
    start = e.touches.length === 1 && !multi ? { x: e.touches[0].clientX, y: e.touches[0].clientY, time: Date.now() } : null
  }) as EventListener, { passive: true, signal })
  target.addEventListener('touchmove', ((e: TouchEvent) => {
    if (e.touches.length > 1) multi = true
    if (start && e.touches[0]) moved ||= Math.hypot(e.touches[0].clientX - start.x, e.touches[0].clientY - start.y) > 10
    if (start && !multi && !selected() && !options.nativeSwipe && options.settings().flow === 'paginated') {
      const dx = e.touches[0].clientX - start.x, dy = e.touches[0].clientY - start.y
      const zoomed = options.settings().zoom > 1 || (window.visualViewport?.scale ?? 1) > 1
      if ((!zoomed || options.canSwipe) && (dx < 0 ? swipeLeft : swipeRight)
        && Math.abs(dx) > 15 && Math.abs(dx) > Math.abs(dy) * 1.5 && e.cancelable) e.preventDefault()
    }
  }) as EventListener, { passive: false, signal })
  target.addEventListener('touchend', ((e: TouchEvent) => {
    const origin = start
    start = null
    const wasMulti = multi
    if (moved || wasMulti) suppressClickUntil = Date.now() + 500
    if (e.touches.length === 0) multi = false
    if (!origin || wasMulti || selected() || !e.changedTouches[0]) return
    const zoomed = options.settings().zoom > 1 || (window.visualViewport?.scale ?? 1) > 1
    if (zoomed && !options.canSwipe) return
    const dx = e.changedTouches[0].clientX - origin.x, dy = e.changedTouches[0].clientY - origin.y
    if (moved || wasMulti || Date.now() - origin.time > 350) suppressClickUntil = Date.now() + 500
    if (!options.nativeSwipe && options.settings().flow === 'paginated'
      && (dx < 0 ? swipeLeft : swipeRight)
      && Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - origin.time < 650) {
      const forward = options.settings().direction === 'rtl' ? dx > 0 : dx < 0
      forward ? options.next() : options.prev()
    }
    start = null
  }) as EventListener, { passive: true, signal })
  target.addEventListener('touchcancel', (() => {
    start = null; multi = false; suppressClickUntil = Date.now() + 500
  }) as EventListener, { passive: true, signal })
  target.addEventListener('click', ((e: MouseEvent) => {
    if (Date.now() < suppressClickUntil || multi || selected() || options.settings().zoom > 1 || (window.visualViewport?.scale ?? 1) > 1) return
    if ((e.target as Element)?.closest?.('a,button,input,select,textarea,[role="button"]')) return
    const width = doc ? doc.documentElement.clientWidth : (target as HTMLElement).clientWidth
    const left = doc ? 0 : (target as HTMLElement).getBoundingClientRect().left
    const x = (e.clientX - left) / width
    if (options.settings().flow === 'paginated' && (x < .2 || x > .8)) {
      const forward = options.settings().direction === 'rtl' ? x < .2 : x > .8
      forward ? options.next() : options.prev()
    } else options.toggle()
  }) as EventListener, { signal })
  target.addEventListener('keydown', ((e: KeyboardEvent) => {
    if ((e.target as Element)?.closest?.('input,textarea,select') || selected()) return
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const forward = options.settings().direction === 'rtl' ? e.key === 'ArrowLeft' : e.key === 'ArrowRight'
      forward ? options.next() : options.prev()
    }
  }) as EventListener, { signal })
  return () => abort.abort()
}
