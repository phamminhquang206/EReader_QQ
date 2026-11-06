import { useCallback, useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, Bookmark, BookMarked, ChevronLeft, ChevronRight, Highlighter, List, MessageSquare, Settings2, Trash2, X, Check, Pencil } from 'lucide-react'
import { db, friendlyError } from './db'
import { Modal } from './components'
import type { Annotation, Book, Locator, ReaderAdapter, ReaderSelection, ReaderSettings, TocItem } from './types'

function Toc({ items, jump }: { items: TocItem[]; jump: (href: string) => void }) {
  return <ul className="toc-list">{items.map((item, i) => <li key={`${item.href}-${i}`}><button onClick={() => jump(item.href)}>{item.label || 'Không có tiêu đề'}</button>{item.subitems?.length ? <Toc items={item.subitems} jump={jump} /> : null}</li>)}</ul>
}

export function Reader({ book, onClose, notify }: { book: Book; onClose: () => void; notify: (message: string) => void }) {
  const host = useRef<HTMLDivElement>(null)
  const adapter = useRef<ReaderAdapter | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [tools, setTools] = useState(true)
  const [panel, setPanel] = useState<'toc' | 'annotations' | 'settings' | null>(null)
  const [settings, setSettings] = useState(book.settings)
  const settingsRef = useRef(settings)
  const [position, setPosition] = useState<Locator | undefined>(book.position)
  const positionRef = useRef(book.position)
  const [selection, setSelection] = useState<ReaderSelection | null>(null)
  const selectionRef = useRef<ReaderSelection | null>(null)
  const [noteEditor, setNoteEditor] = useState<{ selection?: ReaderSelection; annotation?: Annotation } | null>(null)
  const [note, setNote] = useState('')
  const [color, setColor] = useState('#e6c85c')
  const [busy, setBusy] = useState(false)
  const [toc, setToc] = useState<TocItem[]>([])
  const [caps, setCaps] = useState({ text: false, fixed: false, annotations: false })
  const annotations = useLiveQuery(() => db.annotations.where('bookId').equals(book.id).sortBy('createdAt'), [book.id]) ?? []
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve())

  const persist = useCallback(() => {
    const current = positionRef.current
    if (!current) return saveQueue.current
    // Writes are ordered; a late save can never overwrite a newer location.
    saveQueue.current = saveQueue.current.catch(() => {}).then(() => db.books.update(book.id, {
      position: current, lastReadAt: Date.now(), settings: settingsRef.current,
      status: current.fraction >= .995 ? 'finished' : 'reading',
    })).catch(e => { notify(friendlyError(e)) })
    return saveQueue.current
  }, [book.id, notify])
  useEffect(() => {
    let cancelled = false
    let instance: ReaderAdapter | undefined
    let saveTimer: ReturnType<typeof setTimeout>
    const open = async () => {
      try {
        const record = await db.files.get(book.id)
        if (!record) throw new Error('Không tìm thấy file sách. Hãy nhập lại file gốc.')
        const callbacks = {
          onRelocate: (p: Locator) => {
            if (cancelled) return
            positionRef.current = p; setPosition(p)
            clearTimeout(saveTimer); saveTimer = setTimeout(() => void persist(), 300)
          },
          onSelection: (s: ReaderSelection | null) => { if (!cancelled) { selectionRef.current = s; setSelection(s) } },
          onToggleTools: () => { if (!cancelled) setTools(t => !t) },
          onError: (e: unknown) => { if (!cancelled) notify(friendlyError(e)) },
        }
        if (book.format === 'pdf') {
          const { PDFAdapter } = await import('./reader/pdf')
          instance = new PDFAdapter(callbacks)
        } else {
          const { EbookAdapter } = await import('./reader/ebook')
          instance = new EbookAdapter(book.format, callbacks)
        }
        if (cancelled) { instance.destroy(); return }
        adapter.current = instance
        await instance.open(new File([record.data], book.filename), host.current!, settingsRef.current, book.position)
        if (cancelled) { instance.destroy(); return }
        setCaps(instance.capabilities); setToc(instance.toc); setReady(true)
        await persist()
      } catch (e) { if (!cancelled) setError(friendlyError(e)) }
    }
    void open()
    const hidden = () => { if (document.visibilityState === 'hidden') void persist() }
    const pagehide = () => { void persist() }
    document.addEventListener('visibilitychange', hidden)
    window.addEventListener('pagehide', pagehide)
    return () => {
      cancelled = true; clearTimeout(saveTimer); void persist()
      instance?.destroy(); adapter.current = null
      document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', pagehide)
    }
  }, [book.id, book.filename, book.format, book.position, notify, persist])
  useEffect(() => {
    if (ready) void adapter.current?.setAnnotations(annotations).catch(e => notify(friendlyError(e)))
  }, [annotations, ready, notify])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !noteEditor) { setPanel(null); setTools(true) }
      if ((e.target as Element)?.closest('input,textarea,select') || panel || noteEditor) return
      if (e.key === 'ArrowRight') void adapter.current?.next()
      if (e.key === 'ArrowLeft') void adapter.current?.prev()
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [panel, noteEditor])

  const run = async (action: () => Promise<unknown> | undefined) => {
    try { await action() } catch (e) { notify(friendlyError(e)) }
  }
  const update = async (patch: Partial<ReaderSettings>) => {
    if (busy) return
    const next = { ...settingsRef.current, ...patch }
    setBusy(true)
    try {
      await adapter.current?.applySettings(next)
      settingsRef.current = next; setSettings(next)
      await db.books.update(book.id, { settings: next })
    } catch (e) { notify(friendlyError(e)) }
    finally { setBusy(false) }
  }
  const close = async () => { await persist(); onClose() }
  const jump = async (location: Locator | string) => {
    await run(() => adapter.current?.goTo(location)); setPanel(null)
  }
  const add = async (kind: Annotation['kind'], chosen?: ReaderSelection, text = '', chosenColor = color) => {
    const locator = chosen?.locator ?? positionRef.current
    if (!locator || !ready || (book.format === 'pdf' && kind !== 'bookmark')) return
    await run(async () => {
      await db.annotations.add({ id: crypto.randomUUID(), bookId: book.id, kind, locator,
        quote: chosen?.text ?? '', note: text, color: chosenColor, createdAt: Date.now() })
      setSelection(null); notify(kind === 'bookmark' ? 'Đã lưu bookmark' : 'Đã lưu đánh dấu')
    })
  }
  const editNote = (value: { selection?: ReaderSelection; annotation?: Annotation }) => {
    setNote(value.annotation?.note ?? ''); setNoteEditor(value)
  }
  const saveNote = async () => {
    if (!note.trim() || !noteEditor) return
    if (noteEditor.annotation) await run(() => db.annotations.update(noteEditor.annotation!.id, { note: note.trim() }))
    else await add(noteEditor.selection ? 'highlight' : 'note', noteEditor.selection, note.trim())
    setNoteEditor(null)
  }

  return <div className={`reader theme-${settings.theme} ${tools ? '' : 'tools-hidden'}`}>
    <div className="reader-bar reader-top"><button className="icon-button" aria-label="Về thư viện" onClick={() => void close()}><ArrowLeft /></button><div className="reader-title"><strong>{book.title}</strong><span>{book.author}</span></div><div className="reader-actions"><button className="icon-button" aria-label="Thêm bookmark" disabled={!ready} onClick={() => void add('bookmark')}><Bookmark /></button><button className={`icon-button ${panel === 'toc' ? 'active' : ''}`} aria-label="Mục lục" onClick={() => setPanel(panel === 'toc' ? null : 'toc')}><List /></button><button className="icon-button" aria-label="Bookmark và ghi chú" onClick={() => setPanel(panel === 'annotations' ? null : 'annotations')}><BookMarked /></button><button className="icon-button" aria-label="Thiết lập đọc" onClick={() => setPanel(panel === 'settings' ? null : 'settings')}><Settings2 /></button></div></div>
    <div ref={host} className="reader-host" aria-label="Nội dung sách" />
    {!ready && !error && <div className="reader-loading"><span className="spinner" /><p>Đang mở sách…</p></div>}
    {error && <div className="reader-loading"><BookMarked size={42} /><h2>Chưa thể mở sách</h2><p>{error}</p><button className="button primary" onClick={() => void close()}>Về thư viện</button></div>}
    <div className="reader-bar reader-bottom"><button className="icon-button" aria-label="Trang trước" disabled={!ready} onClick={() => void run(() => adapter.current?.prev())}><ChevronLeft /></button><div className="reader-progress"><span>{position?.label || 'Bắt đầu đọc'}</span><input aria-label="Tiến độ đọc" type="range" min="0" max="1000" value={Math.round((position?.fraction ?? 0) * 1000)} disabled={!ready} onChange={e => void run(() => adapter.current?.goToFraction(Number(e.target.value) / 1000))} /></div><span className="percent">{Math.round((position?.fraction ?? 0) * 100)}%</span><button className="icon-button" aria-label="Trang sau" disabled={!ready} onClick={() => void run(() => adapter.current?.next())}><ChevronRight /></button></div>
    {!tools && <button className="reader-show-tools" aria-label="Hiện thanh công cụ" onClick={() => setTools(true)}><Settings2 size={18} /></button>}
    {selection && !noteEditor && book.format !== 'pdf' && <div className="selection-toolbar" onPointerDown={e => e.preventDefault()}><span>{selection.text.slice(0, 42)}{selection.text.length > 42 ? '…' : ''}</span><div>{['#e6c85c', '#97c5a5', '#d5add6'].map(c => <button key={c} aria-label={`Màu ${c}`} className={`color-dot ${color === c ? 'chosen' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />)}<button className="icon-button" aria-label="Highlight đoạn đã chọn" onClick={() => void add('highlight', selectionRef.current ?? undefined)}><Highlighter size={20} /></button><button className="icon-button" aria-label="Ghi chú đoạn đã chọn" onClick={() => editNote({ selection: selectionRef.current ?? undefined })}><MessageSquare size={20} /></button><button className="icon-button" aria-label="Bỏ chọn" onClick={() => setSelection(null)}><X size={18} /></button></div></div>}
    {panel && <><div className="panel-backdrop" onClick={() => setPanel(null)} /><aside className="reader-panel"><header><h2>{panel === 'settings' ? 'Theo cách bạn đọc' : panel === 'toc' ? 'Mục lục' : 'Dấu trang & ghi chú'}</h2><button className="icon-button" aria-label="Đóng bảng" onClick={() => setPanel(null)}><X size={21} /></button></header>
      {panel === 'toc' && (toc.length ? <Toc items={toc} jump={href => void jump(href)} /> : <p className="muted panel-empty">Cuốn sách này không có mục lục.</p>)}
      {panel === 'annotations' && <div className="annotation-list">{book.format !== 'pdf' && <button className="button secondary full-width" disabled={!ready} onClick={() => editNote({})}><MessageSquare size={17} /> Ghi chú vị trí hiện tại</button>}{!annotations.length && <p className="muted panel-empty">Bookmark và các đoạn bạn đánh dấu sẽ nằm ở đây.</p>}{annotations.map(a => <article className="annotation" key={a.id}><button className="annotation-jump" onClick={() => void jump(a.locator)}><span className="eyebrow">{a.kind === 'bookmark' ? 'BOOKMARK' : a.kind === 'note' ? 'GHI CHÚ' : 'HIGHLIGHT'} · {a.locator.label}</span>{a.quote && <blockquote style={{ borderColor: a.color }}>{a.quote}</blockquote>}{a.note && <p>{a.note}</p>}</button><div className="annotation-actions">{book.format !== 'pdf' && <button className="icon-button" aria-label="Sửa ghi chú" onClick={() => editNote({ annotation: a })}><Pencil size={15} /></button>}<button className="icon-button" aria-label="Xóa đánh dấu" onClick={() => void run(() => db.annotations.delete(a.id))}><Trash2 size={15} /></button></div></article>)}</div>}
      {panel === 'settings' && <div className="reader-settings"><fieldset disabled={busy || !ready}><legend>Nền đọc</legend><div className="theme-options">{(['light', 'sepia', 'dark'] as const).map(t => <button key={t} className={`theme-choice theme-${t} ${settings.theme === t ? 'selected' : ''}`} onClick={() => void update({ theme: t })}>{t === 'light' ? 'Sáng' : t === 'sepia' ? 'Giấy ngà' : 'Tối'}{settings.theme === t && <Check size={14} />}</button>)}</div><label>Cách đọc<select aria-label="Cách đọc" value={settings.flow} onChange={e => void update({ flow: e.target.value as ReaderSettings['flow'] })}><option value="paginated">Lật trang</option><option value="scrolled">Cuộn dọc</option></select></label>{caps.text && <><label>Cỡ chữ <span>{settings.fontSize}px</span><input aria-label="Cỡ chữ" type="range" min="14" max="32" value={settings.fontSize} onChange={e => void update({ fontSize: Number(e.target.value) })} /></label><label>Phông chữ<select aria-label="Phông chữ" value={settings.font} onChange={e => void update({ font: e.target.value as ReaderSettings['font'] })}><option value="serif">Có chân · Noto Serif</option><option value="sans-serif">Không chân · Hệ thống</option></select></label><label>Khoảng dòng<select aria-label="Khoảng dòng" value={settings.lineHeight} onChange={e => void update({ lineHeight: Number(e.target.value) })}><option value="1.4">Gọn · 1.4</option><option value="1.7">Vừa · 1.7</option><option value="2">Thoáng · 2.0</option></select></label></>}
      <label>Số trang trên màn hình rộng<select aria-label="Số trang trên màn hình rộng" value={settings.spread} onChange={e => void update({ spread: e.target.value as ReaderSettings['spread'] })}><option value="auto">Tự động · tối đa hai trang</option><option value="none">Một trang</option></select></label><label>Hướng lật trang<select aria-label="Hướng lật trang" value={settings.direction} onChange={e => void update({ direction: e.target.value as ReaderSettings['direction'] })}><option value="auto">Theo sách</option><option value="ltr">Trái sang phải</option><option value="rtl">Phải sang trái</option></select></label>{caps.fixed && <label>Thu phóng <span>{Math.round(settings.zoom * 100)}%</span><input aria-label="Thu phóng" type="range" min="1" max="3" step="0.25" value={settings.zoom} onChange={e => void update({ zoom: Number(e.target.value) })} /></label>}<p className="muted">Thiết lập được lưu riêng cho cuốn sách này. Bạn có thể chụm hai ngón để phóng to màn hình.</p></fieldset></div>}
    </aside></>}
    {noteEditor && <Modal title={noteEditor.annotation ? 'Sửa ghi chú' : 'Thêm ghi chú'} onClose={() => setNoteEditor(null)}>{noteEditor.selection?.text && <blockquote>{noteEditor.selection.text}</blockquote>}<label className="field-label">Ghi chú của bạn<textarea autoFocus rows={6} value={note} onChange={e => setNote(e.target.value)} placeholder="Điều bạn muốn ghi nhớ…" maxLength={12000} /></label><div className="dialog-actions"><button className="button secondary" onClick={() => setNoteEditor(null)}>Hủy</button><button className="button primary" disabled={!note.trim()} onClick={() => void saveNote()}>Lưu ghi chú</button></div></Modal>}
  </div>
}
