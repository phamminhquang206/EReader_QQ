import { beforeEach, expect, it } from 'vitest'
import { db } from '../src/db'
import { importBook, formatFromName, fingerprint } from '../src/library'
import { exportBackup, restoreBackup } from '../src/backup'
import { makeAZW3 } from './e2e/fixtures'

const file = () => new File([new Uint8Array(makeAZW3())], 'Sách.AZW3')
const inspect = async () => ({ title: 'Một cuốn sách AZW3', author: 'Kệ Sách', cover: undefined })
beforeEach(async () => {
  await db.books.clear(); await db.files.clear(); await db.annotations.clear(); await db.collections.clear()
})

it('nhận AZW3, giữ định dạng và chống trùng theo nội dung với MOBI', async () => {
  expect(formatFromName('Sách.AZW3')).toBe('azw3')
  const { book } = await importBook(file(), inspect)
  expect(book.format).toBe('azw3')
  const duplicate = await importBook(new File([file()], 'same.mobi'), inspect)
  expect(duplicate.duplicate).toBe(true)
  expect(duplicate.book.format).toBe('azw3')
  expect(await db.books.count()).toBe(1)
})

it('từ chối AZW3 giả, header bị cắt và file Kindle có DRM', async () => {
  await expect(importBook(new File(['invalid'], 'bad.azw3'), inspect)).rejects.toThrow('không khớp')
  const truncated = Buffer.alloc(68); truncated.write('BOOKMOBI', 60)
  await expect(importBook(new File([truncated], 'short.azw3'), inspect)).rejects.toThrow('Header')
  const encrypted = makeAZW3()
  encrypted.writeUInt16BE(2, encrypted.readUInt32BE(78) + 12)
  await expect(importBook(new File([new Uint8Array(encrypted)], 'locked.azw3'), inspect)).rejects.toThrow('DRM')
  expect(await db.books.count()).toBe(0)
})

it('sao lưu và khôi phục AZW3 cùng vị trí, bookmark, highlight và ghi chú', async () => {
  const { book } = await importBook(file(), inspect)
  const locator = { format: 'azw3' as const, engine: 'foliate-78914ae-v1', value: 'epubcfi(/6/2)', fraction: .5, label: 'Chương 1' }
  await db.books.update(book.id, { position: locator, status: 'reading' })
  await db.annotations.bulkAdd([
    { id: 'azw-bookmark', bookId: book.id, kind: 'bookmark', locator, quote: '', note: '', color: '#e6c85c', createdAt: 1 },
    { id: 'azw-highlight', bookId: book.id, kind: 'highlight', locator, quote: 'Tiếng Việt', note: 'Một ghi chú', color: '#e6c85c', createdAt: 2 },
  ])
  const backup = await exportBackup()
  await db.books.clear(); await db.files.clear(); await db.annotations.clear()
  expect(await restoreBackup(backup)).toBe(1)
  expect((await db.books.get(book.id))?.position).toEqual(locator)
  expect((await db.books.get(book.id))?.format).toBe('azw3')
  expect(await fingerprint((await db.files.get(book.id))!.data)).toBe(book.id)
  expect(await db.annotations.where('bookId').equals(book.id).count()).toBe(2)
  expect((await db.annotations.get('azw-highlight'))?.note).toBe('Một ghi chú')
})
