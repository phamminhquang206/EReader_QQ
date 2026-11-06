import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist'
import workerURL from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { Annotation, Locator, ReaderAdapter, ReaderCallbacks, ReaderSettings, TocItem } from '../types'
import { PageSurface } from './pages'
import { bindReadingGestures } from './gestures'
import { readBlobBuffer } from '../blob'

GlobalWorkerOptions.workerSrc = workerURL
const PDF_ENGINE = 'pdfjs-v1'
async function loadPDF(file: File) {
  return getDocument({ data: new Uint8Array(await readBlobBuffer(file)),
    cMapUrl: '/pdf-assets/cmaps/', cMapPacked: true,
    standardFontDataUrl: '/pdf-assets/standard_fonts/', wasmUrl: '/pdf-assets/wasm/',
    useSystemFonts: true,
  }).promise
}
export async function inspectPDF(file: File) {
  let pdf: PDFDocumentProxy | undefined
  try {
    pdf = await loadPDF(file)
    if (!pdf.numPages) throw new Error('PDF không có trang.')
    const metadata = await pdf.getMetadata()
    const info = metadata.info as Record<string, unknown>
    const page = await pdf.getPage(1)
    const viewport = page.getViewport({ scale: 180 / page.getViewport({ scale: 1 }).width })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width; canvas.height = viewport.height
    await page.render({ canvas, viewport }).promise
    const cover = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', .85))
    return { title: typeof info.Title === 'string' ? info.Title : '', author: typeof info.Author === 'string' ? info.Author : '', cover: cover ?? undefined }
  } catch (error) {
    if (error instanceof Error && error.name === 'PasswordException') throw error
    throw new Error('Không mở được PDF. File có thể bị hỏng hoặc không hợp lệ.')
  } finally { await pdf?.destroy() }
}
export class PDFAdapter implements ReaderAdapter {
  capabilities = { text: false, fixed: true, annotations: false }
  toc: TocItem[] = []
  private pdf?: PDFDocumentProxy
  private surface?: PageSurface
  private settings!: ReaderSettings
  private position?: Locator
  private cleanup?: () => void
  private disposed = false
  constructor(private callbacks: ReaderCallbacks) {}
  async open(file: File, host: HTMLElement, settings: ReaderSettings, position?: Locator) {
    this.settings = settings
    this.pdf = await loadPDF(file)
    if (this.disposed) { await this.pdf.destroy(); return }
    const outline = await this.pdf.getOutline()
    const convert = async (items: NonNullable<typeof outline>): Promise<TocItem[]> => {
      const result: TocItem[] = []
      for (const item of items) {
        try {
          const dest = typeof item.dest === 'string' ? await this.pdf!.getDestination(item.dest) : item.dest
          if (!dest) continue
          const page = typeof dest[0] === 'number' ? dest[0] : await this.pdf!.getPageIndex(dest[0])
          result.push({ label: item.title, href: String(page + 1), subitems: await convert(item.items) })
        } catch { /* Ignore broken/external outline entries. */ }
      }
      return result
    }
    this.toc = await convert(outline ?? [])
    this.surface = new PageSurface(host, this.pdf.numPages, async (container, index, width) => {
      const page = await this.pdf!.getPage(index + 1)
      if (!container.isConnected) return
      const base = page.getViewport({ scale: 1 })
      const cssScale = this.settings.flow === 'paginated'
        ? Math.min(width / this.settings.zoom / base.width, Math.max(100, host.clientHeight - 36) / base.height) * this.settings.zoom
        : width / base.width
      const displayWidth = base.width * cssScale
      // Cap the backing canvas to protect mobile GPU/memory budgets.
      const ratio = Math.min(devicePixelRatio || 1, 2, Math.sqrt(8_000_000 / (displayWidth * displayWidth * base.height / base.width)))
      const viewport = page.getViewport({ scale: cssScale * ratio })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height)
      canvas.style.cssText = `width:${displayWidth}px;height:${base.height * cssScale}px;display:block;`
      container.parentElement!.style.width = `${displayWidth}px`
      container.append(canvas)
      const task = page.render({ canvas, viewport })
      await task.promise
      return () => { canvas.width = 0; canvas.height = 0; page.cleanup() }
    }, (index, offset) => {
      this.position = { format: 'pdf', engine: PDF_ENGINE, value: `${index + 1}:${offset}`,
        fraction: (index + offset) / Math.max(1, this.pdf!.numPages - 1), label: `Trang ${index + 1} / ${this.pdf!.numPages}` }
      this.position.fraction = Math.min(1, this.position.fraction)
      this.callbacks.onRelocate(this.position)
    }, this.callbacks.onError)
    this.cleanup = bindReadingGestures(this.surface.element, {
      settings: () => this.settings, toggle: this.callbacks.onToggleTools,
      next: () => void this.next(), prev: () => void this.prev(),
    })
    await this.surface.configure(settings)
    if (position) await this.goTo(position)
    else await this.surface.goTo(0)
  }
  async goTo(location: Locator | string) {
    if (typeof location !== 'string' && location.engine !== PDF_ENGINE) return this.goToFraction(location.fraction)
    const [page, offset = 0] = (typeof location === 'string' ? location : location.value).split(':').map(Number)
    if (!Number.isFinite(page) || !Number.isFinite(offset)) throw new Error('Vị trí PDF không hợp lệ.')
    await this.surface?.goTo(page - 1, offset)
  }
  async goToFraction(fraction: number) { await this.surface?.goTo(Math.round(fraction * ((this.pdf?.numPages ?? 1) - 1))) }
  async next() { await this.surface?.next() }
  async prev() { await this.surface?.prev() }
  async applySettings(settings: ReaderSettings) { this.settings = settings; await this.surface?.configure(settings) }
  async setAnnotations(_annotations: Annotation[]) { /* PDF supports bookmarks in the app, no document annotations. */ }
  getPosition() { return this.position }
  destroy() { this.disposed = true; this.cleanup?.(); this.surface?.destroy(); void this.pdf?.destroy() }
}
