import { test, expect } from '@playwright/test'
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'
import { makeEPUB } from './fixtures'
import { copyFile, readFile, rm } from 'node:fs/promises'

test.afterEach(async ({}, info) => { await rm(info.outputPath('local-comic.mobi'), { force: true }) })

test('ảnh nhúng trong EPUB cố định vẫn tải sau khi làm sạch HTML', async ({ page }) => {
  const entries = unzipSync(makeEPUB(true))
  entries['OEBPS/page.png'] = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64'))
  entries['OEBPS/content.opf'] = strToU8(strFromU8(entries['OEBPS/content.opf']).replace('</manifest>', '<item id="page-image" href="page.png" media-type="image/png"/></manifest>'))
  for (const i of [1, 2, 3]) {
    entries[`OEBPS/ch${i}.xhtml`] = strToU8(strFromU8(entries[`OEBPS/ch${i}.xhtml`]).replace('<body>', '<body><img src="page.png" width="600" height="900"/>'))
  }
  await page.goto('/')
  await page.getByLabel('Chọn file sách', { exact: true }).setInputFiles({ name: 'comic-images.epub', mimeType: 'application/epub+zip', buffer: Buffer.from(zipSync(entries)) })
  await expect(page.getByRole('heading', { name: 'Kết quả nhập sách' })).toBeVisible()
  await page.getByRole('button', { name: 'Về thư viện', exact: true }).click()
  await page.getByRole('button', { name: 'Đọc Những miền xanh', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Thêm bookmark', exact: true })).toBeEnabled()
  await expect.poll(async () => {
    const frames = page.frames().filter(f => f.url().startsWith('blob:'))
    if (!frames.length) return false
    try {
      return await frames[0].evaluate(() => Array.from(document.images).some(img => img.complete && img.naturalWidth > 0))
    } catch { return false }
  }).toBe(true)
})

test('file MOBI truyện tranh thực tế tải ảnh các trang', async ({ page, browserName }, info) => {
  test.skip(!process.env.LOCAL_COMIC_MOBI, 'Đặt LOCAL_COMIC_MOBI để kiểm tra file cá nhân, không đưa file vào repo.')
  test.setTimeout(120_000)
  // Copy unchanged bytes into a disposable test directory, then remove them.
  const input = info.outputPath('local-comic.mobi')
  await copyFile(process.env.LOCAL_COMIC_MOBI!, input)
  await page.goto('/')
  if (browserName === 'webkit') {
    // Windows WebKit's path-backed large File reads fail with NotFoundError
    // in this test environment. Feed identical bytes through an in-memory File
    // to exercise the parser/renderer without that file-broker limitation.
    const data = await readFile(input)
    const parts = await page.evaluateHandle(() => new Array<Uint8Array<ArrayBuffer>>())
    try {
      for (let offset = 0; offset < data.length; offset += 1024 * 1024) {
        await parts.evaluate((parts, base64) => { parts.push(Uint8Array.from(atob(base64), c => c.charCodeAt(0))) }, data.subarray(offset, offset + 1024 * 1024).toString('base64'))
      }
      await page.evaluate(parts => {
        const transfer = new DataTransfer()
        transfer.items.add(new File(parts, 'local-comic.mobi', { type: 'application/x-mobipocket-ebook' }))
        const input = document.querySelector<HTMLInputElement>('input[aria-label="Chọn file sách"]')!
        input.files = transfer.files
        input.dispatchEvent(new Event('change', { bubbles: true }))
      }, parts)
    } finally { await parts.dispose() }
  } else await page.getByLabel('Chọn file sách', { exact: true }).setInputFiles(input)
  await expect(page.getByRole('heading', { name: 'Kết quả nhập sách' })).toBeVisible({ timeout: 60000 })
  await expect(page.getByText('Đã thêm vào thư viện')).toBeVisible()
  await page.getByRole('button', { name: 'Về thư viện', exact: true }).click()
  await page.locator('.book-open').first().click()
  await expect(page.getByRole('button', { name: 'Thêm bookmark', exact: true })).toBeEnabled({ timeout: 60000 })
  const images = async () => {
    const result = []
    for (const frame of page.frames().filter(f => f.url().startsWith('blob:'))) {
      try { result.push(...await frame.evaluate(() => Array.from(document.images).map(img => ({
        src: img.getAttribute('src')?.slice(0, 80), loaded: img.complete && img.naturalWidth > 0,
        width: img.naturalWidth, height: img.naturalHeight,
        widthFraction: img.getBoundingClientRect().width / document.documentElement.clientWidth,
      })))) } catch { /* Frames may be replaced during initial layout. */ }
    }
    return result
  }
  await expect.poll(async () => (await images()).filter(img => img.loaded).length, { timeout: 20000 }).toBeGreaterThan(0)
  console.log('Ảnh MOBI đã tải:', JSON.stringify(await images()))
  await expect.poll(async () => (await images()).some(img => img.loaded && img.widthFraction > .98)).toBe(true)
  await page.screenshot({ path: info.outputPath('comic-fit.png') })
  const before = await page.locator('.reader-progress > span').textContent()
  await page.getByRole('button', { name: 'Trang sau', exact: true }).click()
  await expect(page.locator('.reader-progress > span')).not.toHaveText(before!)
  await expect.poll(async () => (await images()).filter(img => img.loaded).length, { timeout: 20000 }).toBeGreaterThan(0)
  for (const value of ['500', '1000']) {
    await page.getByRole('slider', { name: 'Tiến độ đọc' }).fill(value)
    await expect(page.locator('.percent')).toHaveText(value === '500' ? '50%' : '100%')
    await expect.poll(async () => (await images()).filter(img => img.loaded).length, { timeout: 20000 }).toBeGreaterThan(0)
  }
})
