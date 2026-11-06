import { test, expect, type Page } from '@playwright/test'
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate'
import { makeEPUB } from './fixtures'

const verse = 'Chữ tình buộc lấy chữ sầu, bạch cẩm vô văn hương lạn mạn, ngọc thụ quỳnh bao đôi tuyết.'
function vietnameseEPUB() {
  const entries = unzipSync(makeEPUB())
  entries['OEBPS/ch1.xhtml'] = strToU8(strFromU8(entries['OEBPS/ch1.xhtml']).replace('<h1>',
    `<p id="font-nfc"><em><span style="font-family: Georgia !important">${verse}</span></em></p><p id="font-nfd"><em><span style="font-family: Georgia !important">${verse.normalize('NFD')}</span></em></p><p id="font-bold"><strong><em>${verse}</em></strong></p><h1>`))
  return Buffer.from(zipSync(entries, { mtime: new Date('2026-01-01') }))
}
async function verifySerif(page: Page) {
  await expect(page.getByRole('button', { name: 'Thêm bookmark', exact: true })).toBeEnabled()
  const frame = page.frames().find(f => f.url().startsWith('blob:'))!
  await frame.waitForSelector('#font-nfd')
  const result = await frame.evaluate(async () => {
    const family = 'KeSach Noto Serif'
    const italic = await document.fonts.load(`italic 24px "${family}"`, document.querySelector('#font-nfd')!.textContent!)
    const boldItalic = await document.fonts.load(`italic 700 24px "${family}"`, 'Chữ tình')
    const span = document.querySelector('#font-nfd span')!
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    ctx.font = `italic 24px "${family}"`
    const nfc = document.querySelector('#font-nfc')!.textContent!
    const nfd = document.querySelector('#font-nfd')!.textContent!
    return {
      family: getComputedStyle(span).fontFamily, style: getComputedStyle(span).fontStyle,
      italicLoaded: italic.some(f => f.family === family && f.status === 'loaded'),
      boldItalicLoaded: boldItalic.some(f => f.family === family && f.status === 'loaded'),
      widthDifference: Math.abs(ctx.measureText(nfc).width - ctx.measureText(nfd).width),
      nfc, nfd,
    }
  })
  expect(result.family).toContain('KeSach Noto Serif')
  expect(result.style).toBe('italic')
  expect(result.italicLoaded).toBe(true)
  expect(result.boldItalicLoaded).toBe(true)
  expect(result.widthDifference).toBeLessThan(.1)
  // Do not normalize book text and invalidate existing CFI character offsets.
  expect(result.nfc).toBe(verse)
  expect(result.nfd).toBe(verse.normalize('NFD'))
}

test('font có chân hiển thị tiếng Việt NFC/NFD in nghiêng, đổi font và đọc offline', async ({ page, context }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await page.getByLabel('Chọn file sách', { exact: true }).setInputFiles({ name: 'dau-tieng-viet.epub', mimeType: 'application/epub+zip', buffer: vietnameseEPUB() })
  await expect(page.getByRole('heading', { name: 'Kết quả nhập sách' })).toBeVisible()
  await page.getByRole('button', { name: 'Về thư viện', exact: true }).click()
  await page.getByRole('button', { name: 'Đọc Một khoảng lặng', exact: true }).click()
  await verifySerif(page)
  await page.getByRole('button', { name: 'Thiết lập đọc', exact: true }).click()
  await page.getByLabel('Phông chữ', { exact: true }).selectOption('sans-serif')
  await expect(page.getByLabel('Phông chữ', { exact: true })).toBeEnabled()
  await page.getByLabel('Phông chữ', { exact: true }).selectOption('serif')
  await expect(page.getByLabel('Phông chữ', { exact: true })).toBeEnabled()
  await expect(page.getByRole('option', { name: 'Có chân · Noto Serif' })).toHaveCount(1)
  await page.getByRole('button', { name: 'Đóng bảng', exact: true }).click()
  await verifySerif(page)
  await page.getByRole('button', { name: 'Về thư viện', exact: true }).click()
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await context.setOffline(true)
  await page.reload()
  await page.getByRole('button', { name: 'Đọc Một khoảng lặng', exact: true }).click()
  await verifySerif(page)
  expect(errors).toEqual([])
})

test('trang chủ dùng Noto Serif cho tiêu đề, chữ nghiêng và tên sách có dấu tách', async ({ page, context }) => {
  await page.goto('/')
  await expect(page.locator('.empty-library h3')).toBeVisible()
  const initial = await page.evaluate(async () => {
    await document.fonts.load('400 24px "Noto Serif UI"', 'Tất cả sách')
    await document.fonts.load('italic 24px "Noto Serif UI"', 'Đọc thêm một trang.')
    return ['.brand > span:last-child', '.welcome h1', '.welcome h1 > span', '.section-title h2', '.empty-library h3']
      .map(selector => getComputedStyle(document.querySelector(selector)!).fontFamily)
  })
  for (const family of initial) expect(family).toContain('Noto Serif UI')
  const title = 'Ỷ thiên đồ long ký'.normalize('NFD')
  const entries = unzipSync(makeEPUB())
  entries['OEBPS/content.opf'] = strToU8(strFromU8(entries['OEBPS/content.opf']).replace('Một khoảng lặng', title))
  await page.getByLabel('Chọn file sách', { exact: true }).setInputFiles({ name: 'tieu-de.epub', mimeType: 'application/epub+zip', buffer: Buffer.from(zipSync(entries)) })
  await expect(page.getByRole('heading', { name: 'Kết quả nhập sách' })).toBeVisible()
  await page.getByRole('button', { name: 'Về thư viện', exact: true }).click()
  await page.getByRole('button', { name: `Đọc ${title}`, exact: true }).click()
  await expect(page.getByRole('button', { name: 'Thêm bookmark', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Về thư viện', exact: true }).click()
  await expect(page.locator('.banner-content h2')).toHaveText(title)
  const checkBanner = async () => {
    const result = await page.locator('.banner-content h2').evaluate(async el => {
      const family = 'Noto Serif UI'
      const loaded = await document.fonts.load(`24px "${family}"`, el.textContent!)
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')!
      ctx.font = `24px "${family}"`
      const text = el.textContent!
      return { family: getComputedStyle(el).fontFamily, loaded: loaded.some(f => f.status === 'loaded'),
        difference: Math.abs(ctx.measureText(text).width - ctx.measureText(text.normalize('NFC')).width) }
    })
    expect(result.family).toContain('Noto Serif UI')
    expect(result.loaded).toBe(true)
    expect(result.difference).toBeLessThan(.1)
  }
  await checkBanner()
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await context.setOffline(true)
  await page.reload()
  await expect(page.locator('.banner-content h2')).toHaveText(title)
  await checkBanner()
})
