import type { ReaderSettings } from '../types'

export function bindReadingGestures(target: Document | HTMLElement, options: {
  settings: () => ReaderSettings
  next: () => void
  prev: () => void
  toggle: () => void
  nativeSwipe?: boolean
  selected?: () => boolean
}) {
  const abort = new AbortController()
  const signal = abort.signal
  let start: { x: number; y: number; time: number } | null = null
  let moved = false, multi = false, suppressClickUntil = 0
  const selected = () => options.selected?.() || !!(target instanceof Document ? target.getSelection()?.toString() : window.getSelection()?.toString())
  target.addEventListener('touchstart', ((e: TouchEvent) => {
    multi = e.touches.length > 1
    moved = false
    start = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, time: Date.now() } : null
  }) as EventListener, { passive: true, signal })
  target.addEventListener('touchmove', ((e: TouchEvent) => {
    if (e.touches.length > 1) multi = true
    if (start && e.touches[0]) moved ||= Math.hypot(e.touches[0].clientX - start.x, e.touches[0].clientY - start.y) > 10
  }) as EventListener, { passive: true, signal })
  target.addEventListener('touchend', ((e: TouchEvent) => {
    if (!start || multi || selected() || options.settings().zoom > 1 || (window.visualViewport?.scale ?? 1) > 1) return
    const dx = e.changedTouches[0].clientX - start.x, dy = e.changedTouches[0].clientY - start.y
    if (moved || Date.now() - start.time > 350) suppressClickUntil = Date.now() + 500
    if (!options.nativeSwipe && options.settings().flow === 'paginated'
      && Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - start.time < 650) {
      const forward = options.settings().direction === 'rtl' ? dx > 0 : dx < 0
      forward ? options.next() : options.prev()
    }
    start = null
  }) as EventListener, { passive: true, signal })
  target.addEventListener('click', ((e: MouseEvent) => {
    if (Date.now() < suppressClickUntil || multi || selected() || options.settings().zoom > 1 || (window.visualViewport?.scale ?? 1) > 1) return
    if ((e.target as Element)?.closest?.('a,button,input,select,textarea,[role="button"]')) return
    const width = target instanceof Document ? target.documentElement.clientWidth : target.clientWidth
    const left = target instanceof Document ? 0 : target.getBoundingClientRect().left
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
