import DOMPurify from 'dompurify'

// This policy belongs to each book document, not to the application's scripts.
const BOOK_CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline' blob:; img-src blob: data:; font-src blob: data:; media-src 'none'; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"
export function sanitizeBookCSS(css: string): string {
  // Remove ordinary remote references early. The per-document CSP also blocks
  // escaped/obfuscated CSS URLs, so CSS parsing is not a security boundary.
  return css.replace(/@import\s+(?:url\(\s*(['"]?)(.*?)\1\s*\)|(['"])(.*?)\3)[^;]*;?/gi,
    (rule, _quote, url, _quote2, quoted) => /^(blob:|data:)/i.test((url ?? quoted ?? '').trim()) ? rule : '')
    .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi,
      (rule, _quote, url) => /^(blob:|data:|#)/i.test(url.trim()) ? rule : 'url("")')
}
export function sanitizeBookDocument(html: string): string {
  const clean = DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true, ADD_TAGS: ['style', 'link', 'meta'],
    // The ebook parser replaces embedded image/CSS/font resources with blob
    // URLs. DOMPurify's default URI policy drops blob: and leaves blank pages.
    // Retain its standard allowlist, plus the parser's internal URI schemes.
    ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|blob|kindle|filepos|mailto|tel|callto|sms|cid|xmpp|matrix):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'audio', 'video', 'base'],
    FORBID_ATTR: ['srcset', 'ping', 'target', 'action', 'formaction'],
  })
  const doc = new DOMParser().parseFromString(clean, 'text/html')
  for (const el of doc.querySelectorAll('style')) el.textContent = sanitizeBookCSS(el.textContent ?? '')
  for (const el of doc.querySelectorAll('[style]')) el.setAttribute('style', sanitizeBookCSS(el.getAttribute('style') ?? ''))
  for (const el of doc.querySelectorAll('meta[http-equiv]')) el.remove()
  for (const el of doc.querySelectorAll('[src], [href], [xlink\\:href]')) {
    for (const attr of ['src', 'href', 'xlink:href']) {
      const value = el.getAttribute(attr)
      if (value && /^(?:https?:|\/\/|javascript:)/i.test(value.trim())) el.removeAttribute(attr)
    }
  }
  const policy = doc.createElement('meta')
  policy.httpEquiv = 'Content-Security-Policy'; policy.content = BOOK_CSP
  doc.head.prepend(policy)
  return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML
}

// All sections (including legacy MOBI, which has no transformTarget) pass here.
export function secureBook(book: any) {
  const urls = new Set<string>()
  const pending = new Map<number, Promise<string>>()
  book.sections.forEach((section: any, index: number) => {
    const load = section.load.bind(section)
    section.load = () => {
      if (!pending.has(index)) pending.set(index, (async () => {
        const originalURL = await load()
        const response = await fetch(originalURL)
        const safe = sanitizeBookDocument(await response.text())
        const url = URL.createObjectURL(new Blob([safe], { type: 'text/html' }))
        urls.add(url)
        return url
      })().catch(error => { pending.delete(index); throw error }))
      return pending.get(index)
    }
    const unload = section.unload?.bind(section)
    section.unload = () => {
      const promise = pending.get(index)
      pending.delete(index)
      void promise?.then(url => { URL.revokeObjectURL(url); urls.delete(url) }).catch(() => {})
      unload?.()
    }
  })
  return () => {
    for (const url of urls) URL.revokeObjectURL(url)
    urls.clear(); pending.clear(); book.destroy?.()
  }
}
