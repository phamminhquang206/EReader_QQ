import { useCallback, useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { ArrowDownToLine, ArrowRight, ArrowUpFromLine, BookCheck, BookMarked, BookOpen, Check, ChevronDown, CircleHelp, CloudOff, Folder, FolderPlus, Grid2X2, HardDrive, LayoutList, Library, Menu, Moon, MoreHorizontal, Plus, RotateCw, Search, Settings2, ShieldCheck, Sun, Trash2, Upload, WifiOff, X } from 'lucide-react'
import { db, deleteBook, deleteCollection, friendlyError, setBookCollection } from './db'
import { importBook, prettySize } from './library'
import { download, exportBackup, restoreBackup } from './backup'
import { Confirm, Cover, Modal } from './components'
import { Reader } from './Reader'
import type { Book, ReadingStatus } from './types'

const statusNames: Record<ReadingStatus, string> = { unread: 'Chưa đọc', reading: 'Đang đọc', finished: 'Đã đọc' }
type Filter = 'all' | 'reading' | 'finished' | `collection:${string}`

export function App() {
  const books = useLiveQuery(() => db.books.toArray()) ?? []
  const collections = useLiveQuery(() => db.collections.toArray().then(items => items.sort((a, b) => a.createdAt - b.createdAt))) ?? []
  const [selectedBook, setSelectedBook] = useState<Book | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('recent')
  const [layout, setLayout] = useState<'grid' | 'list'>('grid')
  const [sidebar, setSidebar] = useState(false)
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('ke-sach-theme') || 'light' } catch { return 'light' } })
  const [toast, setToast] = useState('')
  const [modal, setModal] = useState<'import' | 'collection' | 'storage' | 'help' | null>(null)
  const [collectionName, setCollectionName] = useState('')
  const [detail, setDetail] = useState<Book | null>(null)
  const [deleting, setDeleting] = useState<Book | null>(null)
  const [deletingCollection, setDeletingCollection] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [importResults, setImportResults] = useState<{ filename: string; message: string; ok: boolean }[]>([])
  const [importProgress, setImportProgress] = useState('')
  const [storage, setStorage] = useState<{ usage?: number; quota?: number; persisted?: boolean }>({})
  const [online, setOnline] = useState(navigator.onLine)
  const [drop, setDrop] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const backupInput = useRef<HTMLInputElement>(null)
  const importLock = useRef(false)
  const notify = useCallback((message: string) => setToast(message), [])
  const { needRefresh: [needRefresh], offlineReady: [offlineReady], updateServiceWorker } = useRegisterSW()

  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 6000); return () => clearTimeout(timer) }, [toast])
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('ke-sach-theme', theme) } catch { /* Optional UI preference. */ }
  }, [theme])
  useEffect(() => {
    const change = () => setOnline(navigator.onLine)
    window.addEventListener('online', change); window.addEventListener('offline', change)
    return () => { window.removeEventListener('online', change); window.removeEventListener('offline', change) }
  }, [])
  useEffect(() => {
    // Home-screen apps often resume without navigating: check for a new build
    // on return, but keep activation behind the existing update prompt.
    const checkForUpdate = () => {
      if (document.hidden || !navigator.onLine || !navigator.serviceWorker) return
      void navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL)
        .then(registration => registration?.update())
        .catch(() => { /* Reading remains available if the update server is unreachable. */ })
    }
    document.addEventListener('visibilitychange', checkForUpdate)
    window.addEventListener('online', checkForUpdate)
    return () => {
      document.removeEventListener('visibilitychange', checkForUpdate)
      window.removeEventListener('online', checkForUpdate)
    }
  }, [])
  const run = async (action: () => Promise<unknown>) => {
    try { await action() } catch (error) { notify(friendlyError(error)) }
  }
  const refreshStorage = async () => {
    const estimate = await navigator.storage?.estimate?.()
    const persisted = await navigator.storage?.persisted?.()
    setStorage({ ...estimate, persisted })
  }
  const importFiles = async (files: File[]) => {
    if (!files.length || importLock.current) return
    importLock.current = true; setBusy(true); setModal('import'); setImportResults([])
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        setImportProgress(`${i + 1} / ${files.length} · ${file.name}`)
        try {
          const { duplicate } = await importBook(file)
          setImportResults(prev => [...prev, { filename: file.name, message: duplicate ? 'Đã có trong thư viện' : 'Đã thêm vào thư viện', ok: true }])
        } catch (error) {
          setImportResults(prev => [...prev, { filename: file.name, message: friendlyError(error), ok: false }])
        }
      }
    } finally { setImportProgress(''); setBusy(false); importLock.current = false; if (fileInput.current) fileInput.current.value = '' }
  }
  const createCollection = async () => {
    const name = collectionName.trim()
    if (!name) return
    await run(async () => {
      if (collections.some(c => c.name.toLocaleLowerCase('vi') === name.toLocaleLowerCase('vi'))) throw new Error('Tên bộ sưu tập đã tồn tại.')
      const id = crypto.randomUUID()
      await db.collections.add({ id, name, createdAt: Date.now() })
      setCollectionName(''); setModal(null); setFilter(`collection:${id}`)
    })
  }
  const openStorage = () => { setModal('storage'); void run(refreshStorage) }
  const backup = async () => {
    if (busy) return
    setBusy(true)
    await run(async () => {
      download(await exportBackup(), `ke-sach-${new Date().toISOString().slice(0, 10)}.zip`)
      notify('Đã tạo bản sao lưu. Hãy lưu file ZIP ở nơi an toàn.')
    })
    setBusy(false)
  }
  const restore = async (file?: File) => {
    if (!file || busy) return
    setBusy(true)
    await run(async () => {
      const added = await restoreBackup(file)
      notify(`Đã khôi phục ${added} sách mới; dữ liệu đã có được giữ nguyên.`)
      await refreshStorage()
    })
    setBusy(false)
    if (backupInput.current) backupInput.current.value = ''
  }
  const switchFilter = (value: Filter) => { setFilter(value); setSidebar(false) }
  const reading = books.filter(b => b.status === 'reading')
  const recent = [...reading].sort((a, b) => b.lastReadAt - a.lastReadAt)[0]
  const filtered = books.filter(b => (filter === 'all' || filter === 'reading' && b.status === 'reading' || filter === 'finished' && b.status === 'finished' || filter.startsWith('collection:') && b.collectionIds.includes(filter.slice(11)))
    && `${b.title} ${b.author}`.toLocaleLowerCase('vi').includes(search.toLocaleLowerCase('vi')))
    .sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title, 'vi') : sort === 'added' ? b.importedAt - a.importedAt : (b.lastReadAt || b.importedAt) - (a.lastReadAt || a.importedAt))
  const collectionId = filter.startsWith('collection:') ? filter.slice(11) : null
  const heading = filter === 'all' ? 'Tất cả sách' : filter === 'reading' ? 'Đang đọc' : filter === 'finished' ? 'Đã đọc' : collections.find(c => c.id === collectionId)?.name || 'Bộ sưu tập'
  const totalBytes = books.reduce((sum, book) => sum + book.size, 0)
  const detailBook = detail ? books.find(b => b.id === detail.id) ?? detail : null

  if (selectedBook) return <><Reader book={selectedBook} onClose={() => setSelectedBook(null)} notify={notify} />{toast && <div className="toast" role="status"><Check size={17} />{toast}<button aria-label="Đóng thông báo" onClick={() => setToast('')}><X size={16} /></button></div>}</>

  return <div className="app-shell" onDragOver={e => { e.preventDefault(); if (!busy) setDrop(true) }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(false) }} onDrop={e => { e.preventDefault(); setDrop(false); void importFiles(Array.from(e.dataTransfer.files)) }}>
    {/* iOS Files may disable Kindle files when accept lists unregistered types.
        importBook validates the extension and file signature after selection. */}
    <input className="visually-hidden" aria-label="Chọn file sách" ref={fileInput} type="file" multiple onChange={e => void importFiles(Array.from(e.target.files ?? []))} />
    <input className="visually-hidden" aria-label="Chọn bản sao lưu" ref={backupInput} type="file" accept=".zip" onChange={e => void restore(e.target.files?.[0])} />
    {sidebar && <div className="sidebar-scrim" onClick={() => setSidebar(false)} />}
    <aside className={`sidebar ${sidebar ? 'open' : ''}`}>
      <a className="brand" href="#" onClick={e => { e.preventDefault(); switchFilter('all') }}><span className="brand-icon"><BookOpen size={25} strokeWidth={1.6} /></span><span>Kệ Sách<i>MỘT GÓC RIÊNG ĐỂ ĐỌC</i></span></a>
      <span className="nav-label">KHÔNG GIAN CỦA BẠN</span>
      <nav className="main-nav" aria-label="Thư viện"><button className={filter === 'all' ? 'selected' : ''} onClick={() => switchFilter('all')}><Library size={19} />Tất cả sách<span>{books.length}</span></button><button className={filter === 'reading' ? 'selected' : ''} onClick={() => switchFilter('reading')}><BookOpen size={19} />Đang đọc<span>{reading.length}</span></button><button className={filter === 'finished' ? 'selected' : ''} onClick={() => switchFilter('finished')}><BookCheck size={19} />Đã đọc<span>{books.filter(b => b.status === 'finished').length}</span></button></nav>
      <div className="collection-label"><span className="nav-label">BỘ SƯU TẬP</span><button className="icon-button" aria-label="Tạo bộ sưu tập" onClick={() => setModal('collection')}><Plus size={17} /></button></div>
      <nav className="collection-nav" aria-label="Bộ sưu tập">{collections.map(c => <button key={c.id} className={filter === `collection:${c.id}` ? 'selected' : ''} onClick={() => switchFilter(`collection:${c.id}`)}><Folder size={18} /><span>{c.name}</span><small>{books.filter(b => b.collectionIds.includes(c.id)).length}</small></button>)}{!collections.length && <p className="collection-hint">Gom những cuốn yêu thích<br />vào một góc riêng.</p>}<button className="new-collection" onClick={() => setModal('collection')}><FolderPlus size={17} />Tạo bộ sưu tập</button></nav>
      <div className="sidebar-bottom"><div className="local-card"><span className="local-card-icon"><ShieldCheck size={22} /></span><strong>Thư viện chỉ của bạn</strong><p>Sách được lưu trên thiết bị.<br />Riêng tư, cả khi offline.</p><div className="local-status"><span />Lưu trữ cục bộ</div></div><button className="storage-link" onClick={openStorage}><HardDrive size={17} /><span>{prettySize(totalBytes)} đã lưu</span><Settings2 size={16} /></button><button className="help-link" onClick={() => setModal('help')}><CircleHelp size={17} />Hướng dẫn & thông tin</button></div>
    </aside>
    <div className="main-area">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Mở menu" onClick={() => setSidebar(true)}><Menu size={23} /></button><span>Thư viện</span><span className="breadcrumb-slash">/</span><strong>{heading}</strong></div><div className="top-actions"><span className="connection"><span className={online ? '' : 'offline-dot'} />{online ? (offlineReady || navigator.serviceWorker?.controller ? 'Sẵn sàng đọc offline' : 'Lưu trên thiết bị') : 'Đang offline'}</span><button className="icon-button" aria-label="Tải lại trang" title="Tải lại trang (F5)" disabled={busy} onClick={() => window.location.reload()}><RotateCw size={19} /></button><button className="icon-button" aria-label={theme === 'dark' ? 'Chuyển nền sáng' : 'Chuyển nền tối'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}</button><span className="avatar" title="Thư viện cá nhân"><BookOpen size={14} /></span></div></header>
      <main className="library-main">
        <section className="welcome"><div><div className="eyebrow greeting"><span />MỞ SÁCH, MỞ MỘT THẾ GIỚI</div><h1>Chậm lại một chút.<br /><span>Đọc thêm một trang.</span></h1><p>Mọi cuốn sách yêu thích, trong một không gian của riêng bạn.</p></div><button className="button primary import-top" disabled={busy} onClick={() => fileInput.current?.click()}><Plus size={18} />Thêm sách</button></section>
        <section className={`reading-banner ${recent ? 'has-recent' : ''}`}><div className="banner-content"><span className="eyebrow">{recent ? 'TIẾP TỤC CÂU CHUYỆN CỦA BẠN' : 'MỘT THƯ VIỆN, LUÔN BÊN BẠN'}</span><h2>{recent ? recent.title : 'Cuốn sách tiếp theo đang chờ.'}</h2><p>{recent ? `${recent.author} · Đã đọc ${Math.round((recent.position?.fraction ?? 0) * 100)}%` : 'Mang theo những câu chuyện. Đọc ở bất cứ đâu, kể cả khi không có mạng.'}</p><button className="banner-link" disabled={busy} onClick={() => recent ? setSelectedBook(recent) : fileInput.current?.click()}>{recent ? 'Đọc tiếp' : 'Thêm cuốn sách đầu tiên'}<ArrowRight size={18} /></button></div>{recent ? <div className="banner-cover"><Cover book={recent} small /></div> : <div className="book-art" aria-hidden="true"><div className="art-orbit" /><div className="art-book art-book-back" /><div className="art-book art-book-front"><span>ONE<br />MORE<br /><em>PAGE.</em></span><i /><BookOpen size={28} strokeWidth={1} /></div><span className="art-spark">✳</span></div>}</section>
        <section className="library-section"><div className="section-title"><div><h2>{heading}<span>{filtered.length}</span></h2><p>{filter === 'all' ? 'Những thế giới nhỏ bạn mang theo.' : filter.startsWith('collection:') ? 'Những cuốn sách được bạn chọn riêng.' : 'Mỗi trang sách, một hành trình.'}</p></div>{collectionId && <button className="icon-button" aria-label="Xóa bộ sưu tập" onClick={() => setDeletingCollection(collectionId)}><Trash2 size={18} /></button>}</div>
          <div className="library-toolbar"><label className="search-box"><Search size={18} /><input aria-label="Tìm sách" placeholder="Tìm tên sách, tác giả…" value={search} onChange={e => setSearch(e.target.value)} />{search && <button className="icon-button" aria-label="Xóa tìm kiếm" onClick={() => setSearch('')}><X size={15} /></button>}</label><div className="toolbar-right"><label className="sort-select"><span>Sắp xếp:</span><select aria-label="Sắp xếp sách" value={sort} onChange={e => setSort(e.target.value)}><option value="recent">Gần đây nhất</option><option value="added">Mới thêm</option><option value="title">Tên sách A–Z</option></select><ChevronDown size={15} /></label><div className="view-toggle"><button className={layout === 'grid' ? 'selected' : ''} aria-label="Hiển thị dạng lưới" onClick={() => setLayout('grid')}><Grid2X2 size={17} /></button><button className={layout === 'list' ? 'selected' : ''} aria-label="Hiển thị dạng danh sách" onClick={() => setLayout('list')}><LayoutList size={18} /></button></div></div></div>
          {filtered.length ? <div className={`books-${layout}`}>{filtered.map(book => <article className="book-card" key={book.id}><button className="book-open" onClick={() => setSelectedBook(book)} aria-label={`Đọc ${book.title}`}><Cover book={book} /><div className="book-info"><h3>{book.title}</h3><p>{book.author}</p><div className="book-meta"><span className={`book-status ${book.status}`}>{statusNames[book.status]}</span>{book.status !== 'unread' && <span>{Math.round((book.position?.fraction ?? 0) * 100)}%</span>}</div>{book.status !== 'unread' && <div className="book-progress"><span style={{ width: `${(book.position?.fraction ?? 0) * 100}%` }} /></div>}</div></button><button className="book-more icon-button" aria-label={`Thông tin ${book.title}`} onClick={() => setDetail(book)}><MoreHorizontal size={20} /></button></article>)}</div> : <div className="empty-library"><div className="empty-icon"><BookOpen size={32} strokeWidth={1.3} /><span>+</span></div><h3>{search ? 'Chưa tìm thấy cuốn sách này' : books.length ? 'Một góc trống cho những cuốn sách' : 'Bắt đầu từ một cuốn sách'}</h3><p>{search ? 'Thử tìm bằng tên sách hoặc tác giả khác.' : books.length ? 'Thêm sách vào bộ sưu tập hoặc bắt đầu đọc để thấy sách ở đây.' : <>Thêm sách từ thiết bị để tạo thư viện của bạn.<br />Mọi trang sách đều sẵn sàng, ngay cả khi offline.</>}</p>{!search && !books.length && <button className="button primary" disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={17} />Chọn file sách</button>}<div className="supported-formats"><span>EPUB</span><span>MOBI</span><span>AZW3</span><span>PDF</span>{!books.length && <small>hoặc kéo thả file vào đây</small>}</div></div>}
        </section>
        <footer className="library-footer"><span><CloudOff size={15} />Không tài khoản. Không tải sách lên server.</span><span>Thêm một trang, thêm một điều mới.</span></footer>
      </main>
    </div>
    {drop && <div className="drop-overlay"><Upload size={46} /><h2>Thả sách vào thư viện</h2><p>EPUB · MOBI · AZW3 · PDF</p></div>}
    {toast && <div className="toast" role="status"><Check size={17} />{toast}<button aria-label="Đóng thông báo" onClick={() => setToast('')}><X size={16} /></button></div>}
    {needRefresh && <div className="update-banner" role="status"><span>Có phiên bản mới của Kệ Sách.</span><button disabled={busy} onClick={() => void updateServiceWorker(true)}>Cập nhật ngay</button></div>}
    {modal === 'import' && <Modal title={busy ? 'Đang thêm sách' : 'Kết quả nhập sách'} onClose={() => { if (!busy) setModal(null) }}><p className="muted">File gốc được giữ trên thiết bị này, không tải lên server.</p>{importProgress && <p className="import-progress"><span className="spinner" />{importProgress}</p>}<div className="import-results">{importResults.map((result, i) => <div className={result.ok ? 'success' : 'failure'} key={i}>{result.ok ? <Check size={19} /> : <CircleHelp size={19} />}<div><strong>{result.filename}</strong><p>{result.message}</p></div></div>)}</div><div className="dialog-actions"><button className="button primary" disabled={busy} onClick={() => setModal(null)}>Về thư viện</button></div></Modal>}
    {modal === 'collection' && <Modal title="Một bộ sưu tập mới" onClose={() => setModal(null)}><p className="muted">Một nơi cho tiểu thuyết, truyện tranh, hoặc bất cứ chủ đề nào bạn thích.</p><form onSubmit={e => { e.preventDefault(); void createCollection() }}><label className="field-label">Tên bộ sưu tập<input autoFocus placeholder="Ví dụ: Những ngày đọc chậm" value={collectionName} maxLength={80} onChange={e => setCollectionName(e.target.value)} /></label><div className="dialog-actions"><button type="button" className="button secondary" onClick={() => setModal(null)}>Hủy</button><button className="button primary" disabled={!collectionName.trim()}>Tạo bộ sưu tập</button></div></form></Modal>}
    {modal === 'storage' && <Modal title="Dữ liệu trên thiết bị" onClose={() => { if (!busy) setModal(null) }}><div className="storage-stat"><HardDrive size={28} /><div><strong>{prettySize(storage.usage ?? totalBytes)}</strong><p>{storage.quota ? `trên khoảng ${prettySize(storage.quota)} trình duyệt cho phép` : 'dung lượng sách đã nhập'}</p></div></div><p className="muted">Sách và ghi chú nằm trong trình duyệt này. Xóa dữ liệu website có thể xóa thư viện; hãy giữ một bản sao lưu.</p><div className="settings-row"><div><strong>Lưu trữ bền vững</strong><p>{storage.persisted ? 'Đã được trình duyệt cho phép' : 'Giảm nguy cơ bị trình duyệt tự thu hồi dung lượng'}</p></div><button className="button secondary" disabled={storage.persisted} onClick={() => void run(async () => { const granted = await navigator.storage?.persist?.(); notify(granted ? 'Đã bật lưu trữ bền vững.' : 'Trình duyệt chưa cấp quyền. Bạn vẫn có thể đọc và sao lưu.'); await refreshStorage() })}>{storage.persisted ? 'Đã bật' : 'Bật'}</button></div><div className="backup-actions"><button className="button primary" disabled={busy || !books.length} onClick={() => void backup()}><ArrowDownToLine size={18} />{busy ? 'Đang xử lý…' : 'Xuất bản sao lưu ZIP'}</button><button className="button secondary" disabled={busy} onClick={() => backupInput.current?.click()}><ArrowUpFromLine size={18} />Nhập bản sao lưu</button></div><p className="muted small-text">Bao gồm file sách, bộ sưu tập, tiến độ và đánh dấu. Khôi phục bổ sung dữ liệu, không ghi đè bản ghi đã có. Tối đa 1 GB mỗi bản sao lưu; cần đủ bộ nhớ để đóng gói.</p></Modal>}
    {modal === 'help' && <Modal title="Chào bạn, đây là Kệ Sách" onClose={() => setModal(null)}><div className="help-content"><BookOpen size={40} strokeWidth={1.2} /><p>Không gian cá nhân để đọc EPUB, MOBI, AZW3 và PDF. Thêm file, mở sách, và tiếp tục từ trang bạn đã dừng.</p><h3>Đọc theo cách của bạn</h3><p>Chạm giữa trang để ẩn/hiện công cụ, chạm mép hoặc vuốt để lật trang. Chuyển sang cuộn dọc trong thiết lập. Chọn chữ trong EPUB/MOBI/AZW3 để highlight và ghi chú; trang ảnh có thể ghi chú theo trang. PDF có bookmark và lưu vị trí.</p><h3>Cài lên màn hình chính</h3><p>iPhone: mở bằng Safari → Chia sẻ → Thêm vào MH chính. Android: mở bằng Chrome → menu → Cài đặt ứng dụng hoặc Thêm vào màn hình chính.</p><h3>Luôn có một bản sao</h3><p>Mỗi trình duyệt và thiết bị giữ dữ liệu riêng, chưa có đồng bộ. Xuất bản sao lưu tại mục Dữ liệu trên thiết bị trước khi xóa dữ liệu hoặc chuyển máy.</p><p className="muted">Mỗi file tối đa 300 MB. Chưa hỗ trợ DRM và PDF có mật khẩu. {offlineReady ? 'Ứng dụng đã sẵn sàng offline.' : 'Mở ứng dụng có mạng lần đầu để chuẩn bị đọc offline.'}</p></div></Modal>}
    {detailBook && <Modal title="Thông tin sách" onClose={() => setDetail(null)}><div className="book-detail"><Cover book={detailBook} small /><div><h3>{detailBook.title}</h3><p>{detailBook.author}</p><span className="muted">{detailBook.format.toUpperCase()} · {prettySize(detailBook.size)}</span></div></div><label className="field-label">Trạng thái<select value={detailBook.status} onChange={e => void run(() => db.books.update(detailBook.id, { status: e.target.value as ReadingStatus }))}>{Object.entries(statusNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><p className="field-label">Bộ sưu tập</p>{collections.length ? <div className="collection-checks">{collections.map(c => <label key={c.id}><input type="checkbox" checked={detailBook.collectionIds.includes(c.id)} onChange={e => { const checked = e.currentTarget.checked; void run(() => setBookCollection(detailBook.id, c.id, checked)) }} /><Folder size={17} />{c.name}</label>)}</div> : <p className="muted">Tạo bộ sưu tập từ thanh bên để nhóm sách.</p>}<div className="dialog-actions between"><button className="text-danger" onClick={() => { setDeleting(detailBook); setDetail(null) }}><Trash2 size={16} />Xóa sách</button><button className="button primary" onClick={() => { setSelectedBook(detailBook); setDetail(null) }}>Mở sách<ArrowRight size={17} /></button></div></Modal>}
    {deleting && <Confirm title="Xóa sách khỏi thiết bị?" message={`“${deleting.title}” cùng tiến độ, bookmark và ghi chú sẽ bị xóa. Hãy sao lưu nếu bạn muốn giữ lại.`} onClose={() => setDeleting(null)} onConfirm={() => void run(async () => { await deleteBook(deleting.id); setDeleting(null); notify('Đã xóa sách khỏi thư viện.') })} />}
    {deletingCollection && <Confirm title="Xóa bộ sưu tập?" message="Sách trong bộ sưu tập vẫn được giữ trong thư viện." onClose={() => setDeletingCollection(null)} onConfirm={() => void run(async () => { await deleteCollection(deletingCollection); setDeletingCollection(null); setFilter('all') })} />}
  </div>
}
