import Dexie, { type EntityTable } from 'dexie'
import type { Annotation, Book, BookFile, Collection } from './types'

export class LibraryDB extends Dexie {
  books!: EntityTable<Book, 'id'>
  files!: EntityTable<BookFile, 'id'>
  collections!: EntityTable<Collection, 'id'>
  annotations!: EntityTable<Annotation, 'id'>
  constructor(name = 'ke-sach-v1') {
    super(name)
    this.version(1).stores({
      books: 'id, title, lastReadAt, status, *collectionIds',
      files: 'id', collections: 'id, name', annotations: 'id, bookId, [bookId+kind]',
    })
  }
}
export const db = new LibraryDB()
export async function setBookCollection(bookId: string, collectionId: string, included: boolean) {
  await db.books.where('id').equals(bookId).modify(book => {
    book.collectionIds = included ? [...new Set([...book.collectionIds, collectionId])]
      : book.collectionIds.filter(id => id !== collectionId)
  })
}
export async function deleteBook(id: string) {
  await db.transaction('rw', [db.books, db.files, db.annotations], async () => {
    await db.books.delete(id)
    await db.files.delete(id)
    await db.annotations.where('bookId').equals(id).delete()
  })
}
export async function deleteCollection(id: string) {
  await db.transaction('rw', [db.books, db.collections], async () => {
    await db.books.where('collectionIds').equals(id).modify(book => {
      book.collectionIds = book.collectionIds.filter(value => value !== id)
    })
    await db.collections.delete(id)
  })
}
export function friendlyError(error: unknown): string {
  const name = error instanceof Error ? error.name : ''
  if (/Quota|DiskFull/.test(name)) return 'Thiết bị không còn đủ dung lượng. Hãy xóa bớt sách hoặc dữ liệu rồi thử lại.'
  if (/Password/.test(name)) return 'Chưa hỗ trợ PDF có mật khẩu.'
  if (error instanceof Error && error.message) return error.message
  return 'Không thể xử lý file. Vui lòng thử lại với file khác.'
}
