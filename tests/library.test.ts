import { beforeEach, describe, expect, it, vi } from 'vitest'
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate'
import { db, deleteBook, deleteCollection, setBookCollection } from '../src/db'
import { importBook, fingerprint } from '../src/library'
import { exportBackup, restoreBackup } from '../src/backup'
import { DEFAULT_SETTINGS, type Annotation } from '../src/types'

const epub = () => new File([zipSync({ mimetype: strToU8('application/epub+zip') }) as Uint8Array<ArrayBuffer>], 'Tiếng Việt.epub')
const inspect = async () => ({ title: 'Tiếng Việt', author: 'Tác giả', cover: undefined })

beforeEach(async () => {
  await db.transaction('rw', [db.books, db.files, db.annotations, db.collections], async () => {
    await db.books.clear(); await db.files.clear(); await db.annotations.clear(); await db.collections.clear()
  })
})
describe('Nhập sách và dữ liệu cục bộ', () => {
  it('nhập một lần, giữ nguyên tiến độ khi nhập lại file đổi tên', async () => {
    const file = epub()
    const first = await importBook(file, inspect)
    await db.books.update(first.book.id, { status: 'reading', lastReadAt: 123 })
    const second = await importBook(new File([file], 'Tên khác.epub'), inspect)
    expect(second.duplicate).toBe(true)
    expect(await db.books.count()).toBe(1)
    expect((await db.books.get(first.book.id))?.lastReadAt).toBe(123)
    expect(await fingerprint(new Blob([(await db.files.get(first.book.id))!.data]))).toBe(first.book.id)
  })
  it('file không hợp lệ không tạo bản ghi dở dang', async () => {
    await expect(importBook(new File(['bad'], 'bad.epub'), inspect)).rejects.toThrow('không khớp')
    await expect(importBook(new File([], 'empty.pdf'), inspect)).rejects.toThrow('rỗng')
    await expect(importBook(new File(['text'], 'book.txt'), inspect)).rejects.toThrow('Chỉ hỗ trợ')
    await expect(importBook(epub(), async () => { throw new Error('Parser failed') })).rejects.toThrow('Parser failed')
    expect(await db.books.count()).toBe(0)
    expect(await db.files.count()).toBe(0)
  })
  it('xóa bộ sưu tập giữ sách, xóa sách dọn cả file và annotation', async () => {
    const { book } = await importBook(epub(), inspect)
    await db.collections.add({ id: 'c', name: 'Tiểu thuyết', createdAt: 1 })
    await db.books.update(book.id, { collectionIds: ['c'] })
    await db.annotations.add({ id: 'a', bookId: book.id, kind: 'bookmark', locator: { format: 'epub', engine: 'test', value: 'cfi', fraction: .5, label: 'Chương 2' }, quote: '', note: '', color: '#e6c85c', createdAt: 1 })
    await deleteCollection('c')
    expect((await db.books.get(book.id))?.collectionIds).toEqual([])
    await deleteBook(book.id)
    expect(await db.files.count()).toBe(0)
    expect(await db.annotations.count()).toBe(0)
  })
  it('rollback metadata khi ghi file thất bại vì hết quota', async () => {
    const spy = vi.spyOn(db.files, 'add').mockRejectedValueOnce(new DOMException('Full', 'QuotaExceededError'))
    try {
      await expect(importBook(epub(), inspect)).rejects.toThrow('Full')
      expect(await db.books.count()).toBe(0)
      expect(await db.files.count()).toBe(0)
    } finally { spy.mockRestore() }
  })
  it('thêm nhanh vào nhiều bộ sưu tập không làm mất lựa chọn trước', async () => {
    const { book } = await importBook(epub(), inspect)
    await Promise.all([setBookCollection(book.id, 'a', true), setBookCollection(book.id, 'b', true)])
    expect((await db.books.get(book.id))?.collectionIds.sort()).toEqual(['a', 'b'])
    await setBookCollection(book.id, 'a', false)
    expect((await db.books.get(book.id))?.collectionIds).toEqual(['b'])
  })
})
describe('Sao lưu và khôi phục', () => {
  it('khôi phục đầy đủ file, tiến độ, thiết lập, bộ sưu tập và ghi chú; không ghi đè khi lặp lại', async () => {
    const { book } = await importBook(epub(), inspect)
    const locator = { format: 'epub' as const, engine: 'foliate-78914ae-v1', value: 'epubcfi(/6/2)', fraction: .4, label: 'Chương 2' }
    await db.collections.add({ id: 'collection', name: 'Truyện', createdAt: 1 })
    await db.books.update(book.id, { collectionIds: ['collection'], status: 'reading', position: locator, settings: { ...DEFAULT_SETTINGS, fontSize: 24 } })
    const annotation: Annotation = { id: 'note', bookId: book.id, kind: 'highlight', locator, quote: 'Một câu chuyện', note: 'Ghi nhớ', color: '#e6c85c', createdAt: 1 }
    await db.annotations.add(annotation)
    const backup = await exportBackup()
    await db.books.clear(); await db.files.clear(); await db.annotations.clear(); await db.collections.clear()
    expect(await restoreBackup(backup)).toBe(1)
    expect((await db.books.get(book.id))?.position).toEqual(locator)
    expect((await db.books.get(book.id))?.settings.fontSize).toBe(24)
    expect((await db.collections.get('collection'))?.name).toBe('Truyện')
    expect(await db.annotations.get('note')).toEqual(annotation)
    expect(await fingerprint(new Blob([(await db.files.get(book.id))!.data]))).toBe(book.id)
    await db.books.update(book.id, { title: 'Tên mới' })
    await db.annotations.update('note', { note: 'Ghi chú mới' })
    expect(await restoreBackup(backup)).toBe(0)
    expect((await db.books.get(book.id))?.title).toBe('Tên mới')
    expect((await db.annotations.get('note'))?.note).toBe('Ghi chú mới')
  })
  it('từ chối file bị thay đổi trước khi ghi bất kỳ dữ liệu nào', async () => {
    const { book } = await importBook(epub(), inspect)
    const backup = await exportBackup()
    const entries = unzipSync(new Uint8Array(await backup.arrayBuffer()))
    entries[`books/${book.id}`] = strToU8('corrupted')
    await db.books.clear(); await db.files.clear()
    await expect(restoreBackup(new Blob([zipSync(entries) as Uint8Array<ArrayBuffer>]))).rejects.toThrow('bị thay đổi')
    expect(await db.books.count()).toBe(0)
  })
  it('từ chối phiên bản và cấu trúc không hợp lệ', async () => {
    const invalid = (data: unknown) => new Blob([zipSync({ 'manifest.json': strToU8(JSON.stringify(data)) }) as Uint8Array<ArrayBuffer>])
    await expect(restoreBackup(invalid({ version: 2 }))).rejects.toThrow('Phiên bản')
    await expect(restoreBackup(invalid({ version: 1, books: null, annotations: [], collections: [] }))).rejects.toThrow('Cấu trúc')
    await expect(restoreBackup(new Blob([zipSync({ 'other.txt': strToU8('not a backup') }) as Uint8Array<ArrayBuffer>]))).rejects.toThrow('Không tìm thấy')
  })
  it('từ chối thiết lập không an toàn và không thêm bản ghi nào', async () => {
    await importBook(epub(), inspect)
    const entries = unzipSync(new Uint8Array(await (await exportBackup()).arrayBuffer()))
    const manifest = JSON.parse(strFromU8(entries['manifest.json']))
    manifest.books[0].settings.fontSize = '20; background:url(https://example.com)'
    entries['manifest.json'] = strToU8(JSON.stringify(manifest))
    await db.books.clear(); await db.files.clear()
    await expect(restoreBackup(new Blob([zipSync(entries) as Uint8Array<ArrayBuffer>]))).rejects.toThrow('Thiết lập')
    expect(await db.books.count()).toBe(0)
  })
})
