import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BookOpen, X } from 'lucide-react'
import type { Book } from './types'

export function Cover({ book, small = false }: { book: Book; small?: boolean }) {
  const [url, setURL] = useState('')
  useEffect(() => {
    if (!book.cover) { setURL(''); return }
    const next = URL.createObjectURL(new Blob([book.cover], { type: book.coverType || 'image/jpeg' }))
    setURL(next)
    return () => URL.revokeObjectURL(next)
  }, [book.cover, book.coverType])
  const hue = parseInt(book.id.slice(0, 4), 16) % 5
  return <div className={`book-cover cover-${hue} ${small ? 'small-cover' : ''}`}>
    {url ? <img src={url} alt={`Bìa ${book.title}`} /> : <div className="fallback-cover"><span className="cover-imprint">TỦ SÁCH CÁ NHÂN</span><BookOpen size={small ? 20 : 30} strokeWidth={1} /><strong>{book.title}</strong><span>{book.author}</span><i /></div>}
    <span className="format-tag">{book.format.toUpperCase()}</span>
  </div>
}

export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => element.close()
  }, [])
  return <dialog ref={dialog} className={`modal ${wide ? 'wide' : ''}`} onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
    <header><h2>{title}</h2><button className="icon-button" aria-label="Đóng" onClick={onClose}><X size={21} /></button></header>
    <div className="modal-body">{children}</div>
  </dialog>
}

export function Confirm({ title, message, onConfirm, onClose }: { title: string; message: string; onConfirm: () => void; onClose: () => void }) {
  return <Modal title={title} onClose={onClose}><p>{message}</p><div className="dialog-actions"><button className="button secondary" onClick={onClose}>Hủy</button><button className="button danger" onClick={onConfirm}>Xóa</button></div></Modal>
}
