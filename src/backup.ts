import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'
import { db } from './db'
import { readBlobBuffer } from './blob'
import { fingerprint, formatFromName, MAX_FILE_SIZE } from './library'
import { DEFAULT_SETTINGS, isBookFormat, type Annotation, type Book, type Collection } from './types'

interface BackupManifest {
  version: 1
  exportedAt: string
  books: Omit<Book, 'cover'>[]
  collections: Collection[]
  annotations: Annotation[]
}
const MAX_BACKUP_SIZE = 1024 * 1024 * 1024
export async function exportBackup(): Promise<Blob> {
  const snapshot = await db.transaction('r', [db.books, db.files, db.collections, db.annotations], async () => ({
    books: await db.books.toArray(), files: await db.files.toArray(),
    collections: await db.collections.toArray(), annotations: await db.annotations.toArray(),
  }))
  if (snapshot.files.reduce((size, file) => size + file.data.byteLength, 0)
    + snapshot.books.reduce((size, book) => size + (book.cover?.byteLength ?? 0), 0) > MAX_BACKUP_SIZE - 1024 * 1024) {
    throw new Error('Thư viện vượt giới hạn sao lưu 1 GB. Hãy giảm dung lượng trước khi xuất.')
  }
  const entries: Record<string, Uint8Array> = {}
  for (const file of snapshot.files) entries[`books/${file.id}`] = new Uint8Array(file.data)
  for (const book of snapshot.books) {
    if (book.cover) entries[`covers/${book.id}`] = new Uint8Array(book.cover)
  }
  const manifest: BackupManifest = {
    version: 1, exportedAt: new Date().toISOString(),
    books: snapshot.books.map(({ cover: _cover, ...book }) => book),
    collections: snapshot.collections, annotations: snapshot.annotations,
  }
  entries['manifest.json'] = strToU8(JSON.stringify(manifest))
  const bytes = zipSync(entries, { level: 0 })
  if (bytes.length > MAX_BACKUP_SIZE) throw new Error('Bản sao lưu vượt giới hạn 1 GB.')
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' })
}

function validLocator(value: unknown) {
  if (!value || typeof value !== 'object') return false
  const l = value as Record<string, unknown>
  return isBookFormat(l.format) && typeof l.engine === 'string'
    && typeof l.value === 'string' && typeof l.label === 'string'
    && typeof l.fraction === 'number' && Number.isFinite(l.fraction) && l.fraction >= 0 && l.fraction <= 1
    && (l.offset === undefined || typeof l.offset === 'number' && Number.isFinite(l.offset) && l.offset >= 0 && l.offset <= 1)
}
export async function restoreBackup(file: Blob) {
  if (file.size > 1024 * 1024 * 1024) throw new Error('Bản sao lưu quá lớn (tối đa 1 GB).')
  let totalSize = 0
  const entries = unzipSync(new Uint8Array(await readBlobBuffer(file)), { filter: entry => {
    totalSize += entry.originalSize
    if (totalSize > 1024 * 1024 * 1024) throw new Error('Dữ liệu giải nén vượt quá 1 GB.')
    return true
  } })
  if (!entries['manifest.json']) throw new Error('Không tìm thấy dữ liệu sao lưu Kệ Sách.')
  const manifest = JSON.parse(strFromU8(entries['manifest.json'])) as BackupManifest
  if (manifest.version !== 1) throw new Error('Phiên bản sao lưu chưa được hỗ trợ.')
  if (!Array.isArray(manifest.books) || !Array.isArray(manifest.collections) || !Array.isArray(manifest.annotations)) {
    throw new Error('Cấu trúc bản sao lưu không hợp lệ.')
  }
  const books: Book[] = []
  const files: { id: string; data: ArrayBuffer }[] = []
  const ids = new Set<string>()
  for (const record of manifest.books) {
    if (!/^[a-f0-9]{64}$/.test(record.id) || ids.has(record.id)
      || typeof record.filename !== 'string' || typeof record.title !== 'string'
      || typeof record.author !== 'string' || !['unread', 'reading', 'finished'].includes(record.status)
      || !Array.isArray(record.collectionIds) || !record.collectionIds.every(id => typeof id === 'string')
      || !Number.isFinite(record.importedAt) || !Number.isFinite(record.lastReadAt)
      || (record.position && (!validLocator(record.position) || record.position.format !== record.format))) {
      throw new Error('Thông tin sách trong bản sao lưu không hợp lệ.')
    }
    if (formatFromName(record.filename) !== record.format) throw new Error('Định dạng sách trong bản sao lưu không hợp lệ.')
    const data = entries[`books/${record.id}`]
    if (!data || data.length > MAX_FILE_SIZE) throw new Error(`Thiếu hoặc vượt dung lượng file: ${record.title}`)
    const blob = new Blob([data as Uint8Array<ArrayBuffer>])
    if (await fingerprint(blob) !== record.id) throw new Error(`File bị thay đổi hoặc hỏng: ${record.title}`)
    ids.add(record.id)
    const settings = { ...DEFAULT_SETTINGS, ...record.settings }
    if (!['light', 'dark', 'sepia'].includes(settings.theme) || !['paginated', 'scrolled'].includes(settings.flow)
      || !['auto', 'ltr', 'rtl'].includes(settings.direction) || !['auto', 'none'].includes(settings.spread)
      || !['serif', 'sans-serif'].includes(settings.font)
      || !Number.isFinite(settings.fontSize) || settings.fontSize < 12 || settings.fontSize > 40
      || !Number.isFinite(settings.lineHeight) || settings.lineHeight < 1 || settings.lineHeight > 3
      || !Number.isFinite(settings.zoom) || settings.zoom < 1 || settings.zoom > 3) throw new Error('Thiết lập đọc không hợp lệ.')
    const cover = entries[`covers/${record.id}`]
    books.push({ ...record, size: blob.size, settings, cover: cover ? await new Blob([cover as Uint8Array<ArrayBuffer>]).arrayBuffer() : undefined })
    files.push({ id: record.id, data: await blob.arrayBuffer() })
  }
  for (const c of manifest.collections) {
    if (typeof c.id !== 'string' || typeof c.name !== 'string' || !Number.isFinite(c.createdAt)) throw new Error('Bộ sưu tập không hợp lệ.')
  }
  for (const a of manifest.annotations) {
    if (typeof a.id !== 'string' || !ids.has(a.bookId) || !['bookmark', 'highlight', 'note'].includes(a.kind)
      || !validLocator(a.locator) || a.locator.format !== books.find(b => b.id === a.bookId)?.format
      || typeof a.quote !== 'string' || typeof a.note !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(a.color)
      || !Number.isFinite(a.createdAt)) throw new Error('Đánh dấu trong bản sao lưu không hợp lệ.')
    if (a.locator.format === 'pdf' && a.kind !== 'bookmark') throw new Error('Bản này chỉ hỗ trợ bookmark cho PDF.')
  }
  let added = 0
  await db.transaction('rw', [db.books, db.files, db.collections, db.annotations], async () => {
    for (const c of manifest.collections) if (!await db.collections.get(c.id)) await db.collections.add(c)
    for (let index = 0; index < books.length; index++) {
      if (!await db.books.get(books[index].id)) {
        await db.books.add(books[index]); await db.files.add(files[index]); added++
      }
    }
    for (const a of manifest.annotations) if (!await db.annotations.get(a.id)) await db.annotations.add(a)
  })
  return added
}
export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
