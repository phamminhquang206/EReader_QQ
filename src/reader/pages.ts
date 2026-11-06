import type { ReaderSettings } from '../types'

/** A lazy page surface shared by PDF and fixed-layout EPUB. Only nearby pages stay mounted. */
export class PageSurface {
  private observer?: IntersectionObserver
  private resize: ResizeObserver
  private cleanups = new Map<HTMLElement, () => void>()
  private mounted = new Map<HTMLElement, HTMLElement>()
  private index = 0
  private offset = 0
  private timer?: ReturnType<typeof setTimeout>
  private disposed = false
  private settings!: ReaderSettings
  private rebuilding = false
  private buildRevision = 0
  private motionRevision = 0
  private turning = false
  private animation?: Animation
  readonly element = document.createElement('div')
  constructor(private host: HTMLElement, readonly count: number,
    private render: (container: HTMLElement, index: number, width: number) => Promise<(() => void) | void>,
    private relocate: (index: number, offset: number) => void,
    private onError: (error: unknown) => void) {
    this.element.className = 'page-surface'
    host.append(this.element)
    let lastWidth = host.clientWidth, lastHeight = host.clientHeight
    this.resize = new ResizeObserver(() => {
      if (host.clientWidth === lastWidth && host.clientHeight === lastHeight) return
      lastWidth = host.clientWidth; lastHeight = host.clientHeight
      clearTimeout(this.timer)
      this.timer = setTimeout(() => {
        if (!this.disposed && this.settings) { this.cancelMotion(); void this.rebuild().catch(onError) }
      }, 140)
    })
    this.resize.observe(host)
    this.element.addEventListener('scroll', this.onScroll, { passive: true })
  }
  async configure(settings: ReaderSettings) {
    this.cancelMotion()
    this.settings = settings
    await this.rebuild()
  }
  private async rebuild() {
    if (this.disposed) return
    const revision = ++this.buildRevision
    this.rebuilding = true
    this.observer?.disconnect()
    this.mounted.clear()
    for (const cleanup of this.cleanups.values()) cleanup()
    this.cleanups.clear()
    this.element.replaceChildren()
    const s = this.settings
    const scrolled = s.flow === 'scrolled'
    const columns = !scrolled && s.spread === 'auto' && this.host.clientWidth >= 900 ? 2 : 1
    const width = Math.max(180, (this.host.clientWidth - 36 - (columns - 1) * 16) / columns) * s.zoom
    this.element.classList.toggle('continuous', scrolled)
    this.element.dir = s.direction === 'rtl' ? 'rtl' : 'ltr'
    const start = scrolled ? 0 : Math.floor(this.index / columns) * columns
    const end = scrolled ? this.count : Math.min(start + columns, this.count)
    this.observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const slot = entry.target as HTMLElement
        if (entry.isIntersecting) this.mount(slot, Number(slot.dataset.index), width)
        else this.unmount(slot)
      }
    }, { root: this.element, rootMargin: '900px 300px' })
    const rendering: Promise<void>[] = []
    for (let i = start; i < end; i++) {
      const slot = document.createElement('div')
      slot.className = 'page-slot'; slot.dataset.index = String(i)
      slot.style.width = `${width}px`; slot.style.minHeight = `${Math.min(width * 1.4, 1800)}px`
      slot.setAttribute('aria-label', `Trang ${i + 1}`)
      this.element.append(slot)
      if (scrolled) this.observer.observe(slot)
      else rendering.push(this.mount(slot, i, width))
    }
    if (scrolled) this.restoreOffset()
    // Keep the incoming page hidden until its iframe/images or PDF canvas are
    // ready; fading in an empty placeholder would produce a white flash.
    await Promise.all(rendering)
    if (revision === this.buildRevision) this.rebuilding = false
  }
  private async mount(slot: HTMLElement, index: number, width: number) {
    if (this.mounted.has(slot) || this.disposed) return
    const content = document.createElement('div')
    content.className = 'page-content'
    slot.append(content); this.mounted.set(slot, content)
    await this.render(content, index, width).then(cleanup => {
      if (this.mounted.get(slot) !== content || this.disposed) { cleanup?.(); return }
      if (cleanup) this.cleanups.set(slot, cleanup)
      slot.style.minHeight = `${content.offsetHeight}px`
      if (this.settings.flow === 'scrolled' && index <= this.index) this.restoreOffset()
    }).catch(error => {
      if (this.mounted.get(slot) !== content) return
      content.textContent = 'Không tải được trang. Hãy mở lại sách để thử lại.'
      this.onError(error)
    })
  }
  private unmount(slot: HTMLElement) {
    this.cleanups.get(slot)?.(); this.cleanups.delete(slot)
    this.mounted.get(slot)?.remove(); this.mounted.delete(slot)
  }
  private restoreOffset() {
    const slot = this.element.querySelector<HTMLElement>(`[data-index="${this.index}"]`)
    if (slot) this.element.scrollTop = slot.offsetTop - this.element.offsetTop + this.offset * slot.offsetHeight
  }
  private onScroll = () => {
    if (this.settings?.flow !== 'scrolled' || this.rebuilding) return
    const top = this.element.getBoundingClientRect().top
    const slots = Array.from(this.element.children) as HTMLElement[]
    const slot = slots.find(s => s.getBoundingClientRect().bottom > top + 30)
    if (!slot) return
    this.index = Number(slot.dataset.index)
    this.offset = Math.max(0, Math.min(.99, (top - slot.getBoundingClientRect().top) / slot.offsetHeight))
    this.relocate(this.index, this.offset)
  }
  async goTo(index: number, offset = 0) {
    this.cancelMotion()
    this.index = Math.min(this.count - 1, Math.max(0, index)); this.offset = offset
    if (this.settings.flow === 'scrolled') this.restoreOffset()
    else await this.rebuild()
    this.relocate(this.index, this.offset)
  }
  async next() {
    const step = this.settings.flow === 'paginated' && this.settings.spread === 'auto' && this.host.clientWidth >= 900 ? 2 : 1
    await this.turn(this.index + step, 1)
  }
  async prev() {
    const step = this.settings.flow === 'paginated' && this.settings.spread === 'auto' && this.host.clientWidth >= 900 ? 2 : 1
    await this.turn(this.index - step, -1)
  }
  private cancelMotion() {
    this.motionRevision++
    this.animation?.cancel(); this.animation = undefined
    this.element.style.opacity = ''; this.element.style.transform = ''
    this.element.removeAttribute('data-turning')
    this.turning = false
  }
  private async turn(target: number, direction: number) {
    if (this.disposed || this.turning) return
    target = Math.min(this.count - 1, Math.max(0, target))
    if (target === this.index) return
    if (this.settings.flow !== 'paginated' || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      await this.goTo(target); return
    }
    const revision = ++this.motionRevision
    const sign = this.settings.direction === 'rtl' ? -direction : direction
    this.turning = true
    this.element.dataset.turning = 'true'
    const current = () => !this.disposed && revision === this.motionRevision
    const play = async (frames: Keyframe[], duration: number) => {
      this.animation = this.element.animate(frames, { duration, easing: 'cubic-bezier(.22,.61,.36,1)', fill: 'forwards' })
      await this.animation.finished.catch(() => {})
    }
    try {
      await play([{ opacity: 1, transform: 'translateX(0) scale(1)' },
        { opacity: 0, transform: `translateX(${-sign * 18}px) scale(.992)` }], 220)
      if (!current()) return
      this.element.style.opacity = '0'
      this.animation?.cancel()
      this.index = target; this.offset = 0
      await this.rebuild()
      if (!current()) return
      this.relocate(this.index, this.offset)
      await play([{ opacity: 0, transform: `translateX(${sign * 24}px) scale(.992)` },
        { opacity: 1, transform: 'translateX(0) scale(1)' }], 430)
    } finally { if (current()) this.cancelMotion() }
  }
  destroy() {
    this.cancelMotion()
    this.disposed = true; clearTimeout(this.timer)
    this.resize.disconnect(); this.observer?.disconnect()
    for (const cleanup of this.cleanups.values()) cleanup()
    this.cleanups.clear(); this.mounted.clear(); this.element.remove()
  }
}
