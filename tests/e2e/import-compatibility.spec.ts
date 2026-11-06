import { test, expect } from '@playwright/test'
import { makeEPUB, makeMOBI, makeAZW3, makePDF } from './fixtures'

test('nhập và đọc cả bốn định dạng khi không tải được module JS bổ sung', async ({ browser, baseURL }) => {
  // A service worker must not hide a remaining dependency on lazy chunks.
  const context = await browser.newContext({ serviceWorkers: 'block' })
  try {
    const page = await context.newPage()
    const errors: string[] = []
    const chunks: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(baseURL!)
    await expect(page.getByRole('heading', { name: 'Bắt đầu từ một cuốn sách' })).toBeVisible()
    const input = page.getByLabel('Chọn file sách', { exact: true })
    // Files must allow Kindle extensions even without an iOS type association.
    await expect(input).not.toHaveAttribute('accept')
    await page.route(/\.js(?:\?|$)/, route => {
      chunks.push(route.request().url())
      return route.abort()
    })
    const fixtures = [
      { name: 'sample.epub', buffer: makeEPUB(), title: 'Một khoảng lặng' },
      { name: 'sample.mobi', buffer: makeMOBI(), title: 'Một ngày bình yên' },
      { name: 'sample.azw3', buffer: makeAZW3(), title: 'Một cuốn sách AZW3' },
      { name: 'sample.pdf', buffer: makePDF(), title: 'PDF sample' },
    ]
    for (const { name, buffer, title } of fixtures) {
      // Unknown MIME type matches files that iOS cannot associate with an app.
      await input.setInputFiles({ name, mimeType: 'application/octet-stream', buffer })
      await expect(page.getByText('Đã thêm vào thư viện')).toBeVisible()
      await page.getByRole('button', { name: 'Về thư viện', exact: true }).click()
      await page.getByRole('button', { name: `Đọc ${title}`, exact: true }).click()
      if (name.endsWith('.pdf')) await expect(page.locator('canvas').first()).toBeVisible()
      else await expect(page.getByRole('button', { name: 'Thêm bookmark', exact: true })).toBeEnabled()
      await page.getByRole('button', { name: 'Về thư viện', exact: true }).click()
    }
    await input.setInputFiles({ name: 'unsupported.txt', mimeType: 'text/plain', buffer: Buffer.from('text') })
    await expect(page.getByText('Chỉ hỗ trợ EPUB, MOBI, AZW3 và PDF.', { exact: true })).toBeVisible()
    expect(chunks).toEqual([])
    expect(errors).toEqual([])
  } finally { await context.close() }
})
