import { db } from './db'
import { readBlobBuffer } from './blob'
import { DEFAULT_SETTINGS, isBookFormat, type BookFormat, type Book } from './types'

export const MAX_FILE_SIZE = 300 * 1024 * 1024
export function formatFromName(name: string): BookFormat {
  const ext = name.split('.').pop()?.toLowerCase()
  if (!isBookFormat(ext)) throw new Error('Chỉ hỗ trợ EPUB, MOBI, AZW3 và PDF.')
  return ext
}
export async function fingerprint(file: Blob | ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', file instanceof ArrayBuffer ? file : await readBlobBuffer(file))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
export function languageText(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(languageText).filter(Boolean).join(', ')
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return languageText(obj.name ?? obj.vi ?? obj.en ?? Object.values(obj)[0])
  }
  return ''
}
export async function inspectFile(file: File, format: BookFormat) {
  if (format === 'pdf') {
    const { inspectPDF } = await import('./reader/pdf')
    return inspectPDF(file)
  }
  const { inspectEbook } = await import('./reader/ebook')
  return inspectEbook(file)
}
export async function importBook(file: File, inspect = inspectFile): Promise<{ book: Book; duplicate: boolean }> {
  const format = formatFromName(file.name)
  if (file.size === 0) throw new Error('File rỗng, không có nội dung để đọc.')
  if (file.size > MAX_FILE_SIZE) throw new Error('Mỗi file tối đa 300 MB trong bản này.')
  const header = new Uint8Array(await file.slice(0, 1024).arrayBuffer())
  const signature = new TextDecoder('ascii').decode(header)
  if (format === 'epub' && !(header[0] === 0x50 && header[1] === 0x4b)
    || (format === 'mobi' || format === 'azw3') && signature.slice(60, 68) !== 'BOOKMOBI'
    || format === 'pdf' && !signature.includes('%PDF-')) throw new Error('Nội dung file không khớp định dạng hoặc file bị hỏng.')
  if (format === 'mobi' || format === 'azw3') {
    if (header.byteLength < 82) throw new Error('Header Kindle bị thiếu hoặc file bị hỏng.')
    const firstRecord = new DataView(header.buffer).getUint32(78)
    if (firstRecord < 82 || firstRecord + 16 > file.size) throw new Error('Header Kindle không hợp lệ.')
    const recordHeader = new DataView(await file.slice(firstRecord, firstRecord + 16).arrayBuffer())
    if (recordHeader.getUint16(12) !== 0) throw new Error('Sách Kindle có DRM hoặc mã hóa, chưa được hỗ trợ.')
  }
  const data = await readBlobBuffer(file)
  const id = await fingerprint(data)
  const existing = await db.books.get(id)
  if (existing) return { book: existing, duplicate: true }
  const metadata = await inspect(file, format)
  // ArrayBuffer avoids WebKit's Blob/File IndexedDB storage failures.
  const book: Book = {
    id, format, filename: file.name, size: file.size,
    title: metadata.title || file.name.replace(/\.[^.]+$/, ''),
    author: metadata.author || 'Chưa rõ tác giả', cover: await metadata.cover?.arrayBuffer(), coverType: metadata.cover?.type,
    importedAt: Date.now(), lastReadAt: 0, status: 'unread', collectionIds: [], settings: { ...DEFAULT_SETTINGS },
  }
  await db.transaction('rw', [db.books, db.files], async () => {
    // Concurrent imports of identical bytes must not reset progress.
    if (await db.books.get(id)) return
    await db.books.add(book)
    await db.files.add({ id, data })
  })
  return { book, duplicate: false }
}
export function prettySize(bytes: number) {
  if (bytes === 0) return '0 KB'
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
