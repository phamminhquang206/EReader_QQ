import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { cpSync, mkdirSync, existsSync } from 'node:fs'

// Keep CMaps/fonts/WASM local and precached; PDFs must never depend on a CDN.
mkdirSync('public/pdf-assets', { recursive: true })
for (const folder of ['cmaps', 'standard_fonts', 'wasm']) {
  cpSync(`node_modules/pdfjs-dist/${folder}`, `public/pdf-assets/${folder}`, { recursive: true })
}
mkdirSync('public/licenses', { recursive: true })
for (const dependency of ['foliate-js', 'pdfjs-dist', 'react', 'react-dom', 'dexie', 'dexie-react-hooks', 'dompurify', 'fflate', 'lucide-react', 'workbox-window']) {
  const path = `node_modules/${dependency}/LICENSE`
  if (existsSync(path)) cpSync(path, `public/licenses/${dependency}.txt`)
}

export default defineConfig({
  // Vite's TSX transform is sufficient; avoid an inline React-refresh preamble under strict CSP.
  plugins: [{
    name: 'foliate-compatibility',
    enforce: 'pre',
    transform(code, id) {
      if (id.replaceAll('\\', '/').endsWith('/foliate-js/view.js')) {
        return code.replace("await import('./pdf.js')", '({ makePDF: () => { throw new Error("Use the dedicated PDF.js adapter") } })')
      }
      // The pinned paginator can receive a ResizeObserver/font callback while
      // the previous chapter iframe is detached. Do not lay out a missing body.
      if (id.replaceAll('\\', '/').endsWith('/foliate-js/paginator.js')) {
        return code
          .replace('element[scrollProp], offset, 300, easeOutQuad,', 'element[scrollProp], offset, 650, x => 1 - Math.pow(1 - x, 3),')
          .replace("if ((reason === 'snap' || smooth) && this.hasAttribute('animated'))", "if ((reason === 'snap' || smooth) && this.hasAttribute('animated') && !matchMedia('(prefers-reduced-motion: reduce)').matches)")
          .replace('new ResizeObserver(() => this.expand())', 'new ResizeObserver(() => requestAnimationFrame(() => this.expand()))')
          .replace('new ResizeObserver(() => this.render())', 'new ResizeObserver(() => requestAnimationFrame(() => this.render()))')
          .replace('if (!this.#view) return\n        this.#view.render', 'if (!this.#view?.document?.body) return\n        this.#view.render')
          .replace('render(layout) {\n        if (!layout) return', 'render(layout) {\n        if (!layout || !this.document?.body) return')
          .replace('expand() {\n        const { documentElement }', 'expand() {\n        if (!this.document?.body) return\n        const { documentElement }')
          .replace('#afterScroll(reason) {\n        const range', '#afterScroll(reason) {\n        if (!this.isConnected || !this.#view?.document?.body) return\n        const range')
          .replace('if (shouldGo) await this.#goTo({', 'if (shouldGo && this.isConnected) await this.#goTo({')
          .replace('this.#background.style.background = getBackground(this.#view.document))', 'this.#view?.document?.body ? this.#background.style.background = getBackground(this.#view.document) : null)')
          .replace('then(() => this.#view.expand())', 'then(() => this.#view?.expand())')
      }
    },
  }, VitePWA({
    registerType: 'prompt',
    includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
    manifest: {
      name: 'Kệ Sách — Thư viện cá nhân', short_name: 'Kệ Sách', lang: 'vi',
      description: 'Đọc sách và truyện EPUB, MOBI, AZW3, PDF offline.',
      theme_color: '#f7f8f2', background_color: '#f7f8f2', display: 'standalone',
      start_url: '/', scope: '/',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,mjs,css,html,png,svg,woff,woff2,bcmap,pfb,ttf,wasm}'],
      maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      navigateFallback: '/index.html',
    },
  })],
  build: { target: 'es2022' },
  optimizeDeps: { exclude: ['foliate-js'] },
})
