import * as CFI from 'foliate-js/epubcfi.js'
import { Overlayer } from 'foliate-js/overlayer.js'
import type { Annotation, BookFormat, Locator, ReaderCallbacks, ReaderSettings } from '../types'
import { EBOOK_ENGINE } from './ebook'
import { PageSurface } from './pages'
import { bindReadingGestures } from './gestures'

export class FixedEbook {
  private surface!: PageSurface
  private settings!: ReaderSettings
  private position?: Locator
  private annotations: Annotation[] = []
  private docs = new Map<number, { doc: Document; overlay: any }>()
  private cleanGesture?: () => void
  private disposed = false
  private effectiveSettings(settings: ReaderSettings): ReaderSettings {
    return { ...settings, direction: settings.direction === 'auto' ? (this.book.dir === 'rtl' ? 'rtl' : 'ltr') : settings.direction }
  }
  constructor(private book: any, private format: BookFormat, private callbacks: ReaderCallbacks) {}
  private cfi(index: number, range?: Range) {
    const base = this.book.sections[index].cfi ?? CFI.fake.fromIndex(index)
    return range ? CFI.joinIndir(base, CFI.fromRange(range)) : base
  }
  private resolve(value: string) {
    if (this.book.resolveCFI) return this.book.resolveCFI(value)
    const parts = CFI.parse(value)
    const index = CFI.fake.toIndex((parts.parent ?? parts).shift())
    return { index, anchor: (doc: Document) => CFI.toRange(doc, parts) }
  }
  async open(host: HTMLElement, settings: ReaderSettings, position?: Locator) {
    this.settings = this.effectiveSettings(settings)
    this.surface = new PageSurface(host, this.book.sections.length,
      (container, index, width) => this.render(container, index, width),
      (index, offset) => {
        this.position = { format: this.format, engine: EBOOK_ENGINE, value: this.cfi(index),
          fraction: index / Math.max(1, this.book.sections.length - 1), label: `Trang ${index + 1}`, offset }
        this.callbacks.onRelocate(this.position)
      }, this.callbacks.onError)
    this.cleanGesture = bindReadingGestures(this.surface.element, {
      settings: () => this.settings, toggle: this.callbacks.onToggleTools,
      next: () => void this.next(), prev: () => void this.prev(),
      selected: () => Array.from(this.docs.values()).some(({ doc }) => !!doc.getSelection()?.toString()),
      canSwipe: dx => this.surface.canSwipe(dx),
    })
    await this.surface.configure(this.settings)
    if (position) await this.goTo(position)
    else await this.surface.goTo(0)
  }
  private async render(container: HTMLElement, index: number, width: number) {
    const src = await this.book.sections[index].load()
    if (this.disposed || !container.isConnected) return
    const iframe = document.createElement('iframe')
    iframe.title = `Trang ${index + 1}`
    // WebKit needs allow-scripts for layout; every document has script-src 'none'.
    iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts')
    iframe.style.cssText = 'border:0;display:block;transform-origin:top left;'
    const loaded = new Promise<void>((resolve, reject) => {
      iframe.onload = () => resolve(); iframe.onerror = () => reject(new Error('Không mở được trang truyện.'))
    })
    iframe.src = src; container.append(iframe)
    await loaded
    if (this.disposed || !container.isConnected) { iframe.remove(); return }
    const doc = iframe.contentDocument!
    const meta = doc.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? ''
    const defaultViewport = this.book.rendition?.viewport
    const viewport = typeof defaultViewport === 'string' ? defaultViewport : `width=${defaultViewport?.width ?? ''},height=${defaultViewport?.height ?? ''}`
    let vw = Number((meta + viewport).match(/width\s*=\s*([\d.]+)/)?.[1]) || 800
    let vh = Number((meta + viewport).match(/height\s*=\s*([\d.]+)/)?.[1]) || 1200
    // Some Kindle comics put one scan inside a much larger publisher viewport.
    // Fit the scan itself; leave positioned pages with text/multiple images intact.
    const image = doc.images.length === 1 ? doc.images[0] : undefined
    if (image?.naturalWidth && image.naturalHeight && !doc.body.textContent?.trim() && !doc.querySelector('svg')) {
      vw = image.naturalWidth; vh = image.naturalHeight
      for (let element: HTMLElement | null = image; element; element = element.parentElement) {
        for (const [property, value] of Object.entries({
          position: 'static', inset: 'auto', margin: '0', padding: '0', border: '0',
          width: '100%', height: '100%', 'min-width': '0', 'min-height': '0',
          'max-width': 'none', 'max-height': 'none', transform: 'none',
          display: 'block', overflow: 'hidden', 'box-sizing': 'border-box',
        })) element.style.setProperty(property, value, 'important')
      }
      image.style.setProperty('object-fit', 'contain', 'important')
    }
    const scale = this.settings.flow === 'paginated'
      ? Math.min(width / this.settings.zoom / vw, Math.max(100, this.surface.element.clientHeight) / vh) * this.settings.zoom
      : width / vw
    const displayWidth = vw * scale
    iframe.style.width = `${vw}px`; iframe.style.height = `${vh}px`; iframe.style.transform = `scale(${scale})`
    container.parentElement!.style.width = `${displayWidth}px`
    container.style.cssText = `width:${displayWidth}px;height:${vh * scale}px;position:relative;overflow:hidden;`
    const overlay = new Overlayer()
    overlay.element.style.cssText += ';position:absolute;inset:0;pointer-events:none;'
    // Add overlays outside the book DOM so annotation anchors never shift.
    const layer = document.createElement('div')
    layer.style.cssText = `position:absolute;inset:0;pointer-events:none;width:${vw}px;height:${vh}px;transform:scale(${scale});transform-origin:top left;`
    layer.append(overlay.element); container.append(layer)
    this.docs.set(index, { doc, overlay })
    this.draw(index)
    const clean = bindReadingGestures(doc, { settings: () => this.settings, toggle: this.callbacks.onToggleTools,
      next: () => void this.next(), prev: () => void this.prev(), canSwipe: dx => this.surface.canSwipe(dx) })
    const select = () => {
      const selection = doc.getSelection()
      if (!selection?.toString().trim()) return this.callbacks.onSelection(null)
      this.callbacks.onSelection({ text: selection.toString().slice(0, 12000), locator: {
        format: this.format, engine: EBOOK_ENGINE, value: this.cfi(index, selection.getRangeAt(0)),
        fraction: index / Math.max(1, this.book.sections.length - 1), label: `Trang ${index + 1}`,
      } })
    }
    doc.addEventListener('selectionchange', select)
    return () => {
      clean(); doc.removeEventListener('selectionchange', select)
      if (this.docs.get(index)?.doc === doc) this.docs.delete(index)
      iframe.remove(); this.book.sections[index].unload?.()
    }
  }
  private draw(index: number) {
    const entry = this.docs.get(index)
    if (!entry) return
    for (const a of this.annotations) {
      if (a.kind !== 'highlight' || a.locator.engine !== EBOOK_ENGINE) continue
      try {
        const resolved = this.resolve(a.locator.value)
        if (resolved.index === index) entry.overlay.add(a.id, resolved.anchor(entry.doc), Overlayer.highlight, { color: a.color })
      } catch { /* An incompatible annotation remains available in the list. */ }
    }
  }
  async goTo(location: Locator | string) {
    const value = typeof location === 'string' ? location : location.value
    if (typeof location !== 'string' && location.engine !== EBOOK_ENGINE) return this.goToFraction(location.fraction)
    const resolved = CFI.isCFI.test(value) ? this.resolve(value) : await this.book.resolveHref(value)
    await this.surface.goTo(resolved.index, typeof location === 'string' ? 0 : location.offset ?? 0)
  }
  async goToFraction(fraction: number) { await this.surface.goTo(Math.round(fraction * (this.book.sections.length - 1))) }
  async next() { await this.surface.next() }
  async prev() { await this.surface.prev() }
  async applySettings(settings: ReaderSettings) { this.settings = this.effectiveSettings(settings); await this.surface.configure(this.settings) }
  async setAnnotations(annotations: Annotation[]) {
    for (const { overlay } of this.docs.values()) for (const a of this.annotations) overlay.remove(a.id)
    this.annotations = annotations
    for (const index of this.docs.keys()) this.draw(index)
  }
  getPosition() { return this.position }
  destroy() { this.disposed = true; this.cleanGesture?.(); this.surface?.destroy(); this.docs.clear() }
}
