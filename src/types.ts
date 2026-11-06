export const BOOK_FORMATS = ['epub', 'mobi', 'azw3', 'pdf'] as const
export type BookFormat = typeof BOOK_FORMATS[number]
export function isBookFormat(value: unknown): value is BookFormat {
  return typeof value === 'string' && (BOOK_FORMATS as readonly string[]).includes(value)
}
export type ReadingStatus = 'unread' | 'reading' | 'finished'
export type Theme = 'light' | 'sepia' | 'dark'
export interface ReaderSettings {
  theme: Theme
  flow: 'paginated' | 'scrolled'
  fontSize: number
  lineHeight: number
  font: 'serif' | 'sans-serif'
  direction: 'auto' | 'ltr' | 'rtl'
  spread: 'auto' | 'none'
  zoom: number
}
export const DEFAULT_SETTINGS: ReaderSettings = {
  theme: 'light', flow: 'paginated', fontSize: 20, lineHeight: 1.7,
  font: 'serif', direction: 'auto', spread: 'auto', zoom: 1,
}
export interface Locator {
  format: BookFormat
  engine: string
  value: string
  fraction: number
  label: string
  offset?: number
}
export interface Book {
  id: string
  format: BookFormat
  filename: string
  title: string
  author: string
  size: number
  importedAt: number
  lastReadAt: number
  status: ReadingStatus
  collectionIds: string[]
  settings: ReaderSettings
  position?: Locator
  cover?: ArrayBuffer
  coverType?: string
}
export interface BookFile { id: string; data: ArrayBuffer }
export interface Collection { id: string; name: string; createdAt: number }
export interface Annotation {
  id: string
  bookId: string
  kind: 'bookmark' | 'highlight' | 'note'
  locator: Locator
  quote: string
  note: string
  color: string
  createdAt: number
}
export interface TocItem { label: string; href: string; subitems?: TocItem[] }
export interface ReaderCapabilities { text: boolean; fixed: boolean; annotations: boolean }
export interface ReaderSelection { locator: Locator; text: string }
export interface ReaderCallbacks {
  onRelocate: (position: Locator) => void
  onSelection: (selection: ReaderSelection | null) => void
  onToggleTools: () => void
  onError: (error: unknown) => void
}
export interface ReaderAdapter {
  capabilities: ReaderCapabilities
  toc: TocItem[]
  open: (file: File, host: HTMLElement, settings: ReaderSettings, position?: Locator) => Promise<void>
  goTo: (location: Locator | string) => Promise<void>
  goToFraction: (fraction: number) => Promise<void>
  next: () => Promise<void>
  prev: () => Promise<void>
  applySettings: (settings: ReaderSettings) => Promise<void>
  setAnnotations: (annotations: Annotation[]) => Promise<void>
  getPosition: () => Locator | undefined
  destroy: () => void
}
