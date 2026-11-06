import { makeBook } from 'foliate-js/view.js'
import 'foliate-js/view.js'
import { Overlayer } from 'foliate-js/overlayer.js'
import { languageText } from '../library'
import type { Annotation, BookFormat, Locator, ReaderAdapter, ReaderCallbacks, ReaderSettings, TocItem } from '../types'
import { secureBook } from './security'
import { bindReadingGestures } from './gestures'
import { FixedEbook } from './fixed'
import { getReaderFontCSS, READER_SERIF_FAMILY } from './fonts'

export const EBOOK_ENGINE = 'foliate-78914ae-v1'
export async function inspectEbook(file: File) {
  let book: any
  try {
    book = await makeBook(file)
    if (!book.sections?.length) throw new Error('Sách không có nội dung.')
    return { title: languageText(book.metadata?.title), author: languageText(book.metadata?.author), cover: await book.getCover?.() as Blob | undefined }
  } catch (e) {
    if (e instanceof Error && /encrypt|drm/i.test(e.message)) throw new Error('Sách có DRM hoặc mã hóa, chưa được hỗ trợ.')
    throw new Error('Không mở được EPUB/MOBI/AZW3. File có thể hỏng, có DRM hoặc dùng biến thể chưa hỗ trợ.')
  } finally { book?.destroy?.() }
}
export class EbookAdapter implements ReaderAdapter {
  capabilities = { text: true, fixed: false, annotations: true }
  toc: TocItem[] = []
  private view: any
  private settings!: ReaderSettings
  private position?: Locator
  private annotations: Annotation[] = []
  private cleanups: (() => void)[] = []
  private fixed?: FixedEbook
  private disposed = false
  private pageTurn?: Promise<void>
  private bookDirection = 'ltr'
  private secureCleanup?: () => void
  constructor(private format: BookFormat, private callbacks: ReaderCallbacks) {}
  async open(file: File, host: HTMLElement, settings: ReaderSettings, position?: Locator) {
    this.settings = settings
    const book = await makeBook(file)
    if (this.disposed) { book.destroy?.(); return }
    this.secureCleanup = secureBook(book)
    this.bookDirection = book.dir ?? 'ltr'
    this.toc = book.toc ?? []
    if (book.rendition?.layout === 'pre-paginated') {
      this.capabilities = { text: false, fixed: true, annotations: true }
      this.fixed = new FixedEbook(book, this.format, this.callbacks)
      await this.fixed.open(host, settings, position)
      return
    }
    this.view = document.createElement('foliate-view')
    this.view.style.cssText = 'display:block;width:100%;height:100%;'
    host.append(this.view)
    this.view.addEventListener('external-link', (e: Event) => e.preventDefault())
    this.view.addEventListener('load', ({ detail }: any) => this.onLoad(detail))
    this.view.addEventListener('relocate', ({ detail }: any) => {
      const fraction = Number.isFinite(detail.fraction) ? detail.fraction : 0
      this.position = { format: this.format, engine: EBOOK_ENGINE, value: detail.cfi,
        fraction: Math.min(1, Math.max(0, fraction)), label: detail.tocItem?.label || `Vị trí ${(detail.location?.current ?? 0) + 1}` }
      this.callbacks.onRelocate(this.position)
    })
    this.view.addEventListener('draw-annotation', ({ detail }: any) => detail.draw(Overlayer.highlight, { color: detail.annotation.color }))
    this.view.addEventListener('create-overlay', () => { void this.drawAnnotations() })
    await this.view.open(book)
    if (this.disposed) return
    await this.applySettings(settings)
    if (position?.engine === EBOOK_ENGINE && position.format === this.format) await this.view.init({ lastLocation: position.value })
    else if (position) await this.view.goToFraction(position.fraction)
    else await this.view.init({})
  }
  private onLoad({ doc, index }: { doc: Document; index: number }) {
    this.applyFont(doc)
    this.cleanups.push(bindReadingGestures(doc, {
      settings: () => ({ ...this.settings, direction: this.settings.direction === 'auto' ? this.bookDirection as 'ltr' | 'rtl' : this.settings.direction }), nativeSwipe: true,
      next: () => void this.next().catch(this.callbacks.onError), prev: () => void this.prev().catch(this.callbacks.onError),
      toggle: this.callbacks.onToggleTools,
    }))
    let timer: ReturnType<typeof setTimeout>
    const change = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const sel = doc.getSelection()
        if (!sel || sel.isCollapsed || !sel.toString().trim()) { this.callbacks.onSelection(null); return }
        const locator: Locator = { format: this.format, engine: EBOOK_ENGINE,
          value: this.view.getCFI(index, sel.getRangeAt(0)), fraction: this.position?.fraction ?? 0,
          label: this.position?.label ?? 'Đoạn văn' }
        this.callbacks.onSelection({ locator, text: sel.toString().slice(0, 12000) })
      }, 180)
    }
    doc.addEventListener('selectionchange', change)
    this.cleanups.push(() => { clearTimeout(timer); doc.removeEventListener('selectionchange', change) })
  }
  async goTo(location: Locator | string) {
    if (this.fixed) return this.fixed.goTo(location)
    await this.pageTurn
    if (this.disposed) return
    if (typeof location !== 'string' && location.engine !== EBOOK_ENGINE) return this.goToFraction(location.fraction)
    await this.view.goTo(typeof location === 'string' ? location : location.value)
  }
  async goToFraction(fraction: number) {
    if (this.fixed) return this.fixed.goToFraction(fraction)
    await this.pageTurn
    if (this.disposed) return
    await this.view.goToFraction(Math.min(1, Math.max(0, fraction)))
  }
  private async turnPage(forward: boolean) {
    if (this.disposed || this.pageTurn) return
    this.pageTurn = forward ? this.view?.next() : this.view?.prev()
    try { await this.pageTurn } finally { this.pageTurn = undefined }
  }
  async next() { if (this.fixed) await this.fixed.next(); else await this.turnPage(true) }
  async prev() { if (this.fixed) await this.fixed.prev(); else await this.turnPage(false) }
  async applySettings(settings: ReaderSettings) {
    this.settings = settings
    if (this.fixed) return this.fixed.applySettings(settings)
    await this.pageTurn
    if (this.disposed) return
    const renderer = this.view?.renderer
    if (!renderer) return
    renderer.toggleAttribute('animated', !matchMedia('(prefers-reduced-motion: reduce)').matches)
    renderer.setAttribute('flow', settings.flow)
    renderer.setAttribute('max-column-count', settings.spread === 'none' ? '1' : '2')
    renderer.setAttribute('max-inline-size', '660')
    renderer.setAttribute('gap', '7%')
    const palettes = { light: ['#fdfdf9', '#28342d'], dark: ['#19231e', '#e2e7de'], sepia: ['#f3ead8', '#453c2d'] }
    const [bg, fg] = palettes[settings.theme]
    const fontCSS = settings.font === 'serif' ? await getReaderFontCSS() : ''
    if (this.disposed) return
    const family = settings.font === 'serif' ? `'${READER_SERIF_FAMILY}', serif` : 'system-ui, sans-serif'
    renderer.setStyles(`${fontCSS}\nhtml { color: ${fg} !important; background: ${bg} !important; color-scheme: ${settings.theme === 'dark' ? 'dark' : 'light'}; }
      body { color: inherit !important; background: transparent !important; font-size: ${settings.fontSize}px !important; }
      body, body :not(svg, svg *) { font-family: ${family} !important; }
      p, li, blockquote, dd { font-size: inherit !important; line-height: ${settings.lineHeight} !important; } img, svg { max-width: 100%; } a { color: #62916c; }`)
    for (const { doc } of renderer.getContents()) if (doc) this.applyFont(doc)
  }
  private applyFont(doc: Document) {
    const family = this.settings.font === 'serif' ? `'${READER_SERIF_FAMILY}', serif` : 'system-ui, sans-serif'
    // Publisher styles may use inline !important or high-specificity font rules.
    // Change only the family: preserve italic/bold, text nodes and CFI offsets.
    for (const element of doc.querySelectorAll<HTMLElement>('body, body *')) {
      if (element.namespaceURI === 'http://www.w3.org/1999/xhtml') element.style.setProperty('font-family', family, 'important')
    }
  }
  async setAnnotations(annotations: Annotation[]) {
    if (this.fixed) return this.fixed.setAnnotations(annotations)
    for (const a of this.annotations) {
      if (a.kind === 'highlight') await this.view?.deleteAnnotation({ value: a.locator.value }).catch(() => {})
    }
    this.annotations = annotations
    await this.drawAnnotations()
  }
  private async drawAnnotations() {
    if (!this.view?.renderer) return
    for (const a of this.annotations) {
      if (a.kind === 'highlight' && a.locator.engine === EBOOK_ENGINE) {
        await this.view.addAnnotation({ value: a.locator.value, color: a.color }).catch(this.callbacks.onError)
      }
    }
  }
  getPosition() { return this.fixed?.getPosition() ?? this.position }
  destroy() {
    this.disposed = true
    this.fixed?.destroy()
    for (const cleanup of this.cleanups) cleanup()
    this.view?.close(); this.view?.remove()
    this.secureCleanup?.()
  }
}
