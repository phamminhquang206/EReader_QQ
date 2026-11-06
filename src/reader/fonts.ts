// Full font files include both Vietnamese letters and combining diacritics.
// Blob URLs also keep the book iframe's font-src policy restricted to blob/data.
const faces = [
  { file: 'Regular', weight: '400', style: 'normal' },
  { file: 'Italic', weight: '400', style: 'italic' },
  { file: 'Bold', weight: '700', style: 'normal' },
  { file: 'BoldItalic', weight: '700', style: 'italic' },
] as const

export const READER_SERIF_FAMILY = 'KeSach Noto Serif'
let stylesheet: Promise<string> | undefined
export function getReaderFontCSS(): Promise<string> {
  stylesheet ??= Promise.all(faces.map(async ({ file, weight, style }) => {
    const response = await fetch(`${import.meta.env.BASE_URL}fonts/NotoSerif-${file}.ttf`)
    if (!response.ok) throw new Error('Không tải được font đọc sách. Hãy mở app có mạng để cập nhật tài nguyên offline.')
    const data = await response.arrayBuffer()
    const face = new FontFace(READER_SERIF_FAMILY, data, { weight, style })
    await face.load()
    // Decode the font before laying out the first chapter; do not measure with a fallback.
    document.fonts.add(face)
    const url = URL.createObjectURL(new Blob([data], { type: 'font/ttf' }))
    return `@font-face { font-family: '${READER_SERIF_FAMILY}'; src: url('${url}') format('truetype'); font-style: ${style}; font-weight: ${weight}; font-display: block; }`
  })).then(rules => rules.join('\n')).catch(error => { stylesheet = undefined; throw error })
  return stylesheet
}
