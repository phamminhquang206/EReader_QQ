import { test, expect, type Page } from '@playwright/test'
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'
import { makeEPUB } from './fixtures'

function imageOnlyComic() {
  const entries = unzipSync(makeEPUB(true))
  entries['OEBPS/scan.svg'] = strToU8('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="#abc"/><circle cx="300" cy="450" r="200" fill="#456"/></svg>')
  entries['OEBPS/content.opf'] = strToU8(strFromU8(entries['OEBPS/content.opf']).replace('</manifest>', '<item id="scan" href="scan.svg" media-type="image/svg+xml"/></manifest>'))
  for (const i of [1, 2, 3]) entries[`OEBPS/ch${i}.xhtml`] = strToU8(`<html xmlns="http://www.w3.org/1999/xhtml"><head><meta name="viewport" content="width=1264,height=1680"/></head><body><div style="position:absolute;top:24%;width:1264px"><img src="scan.svg" width="600" height="900"/></div><div id="PV"></div></body></html>`)
  return Buffer.from(zipSync(entries))
}

async function swipe(page: Page, dx: number) {
  await page.evaluate(dx => {
    const doc = document.querySelector<HTMLIFrameElement>('.page-content iframe')!.contentDocument!
    const start = { clientX: 300, clientY: 350 }
    const end = { clientX: 300 + dx, clientY: 350 }
    for (const [type, touches, changedTouches] of [
      ['touchstart', [start], [start]], ['touchmove', [end], [end]], ['touchend', [], [end]],
    ] as const) {
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperties(event, { touches: { value: touches }, changedTouches: { value: changedTouches } })
      doc.body.dispatchEvent(event)
    }
  }, dx)
}

test('trang một ảnh vừa màn hình, zoom vẫn vuốt tại mép và giữ thao tác kéo xem ảnh', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await page.getByLabel('Chọn file sách', { exact: true }).setInputFiles({ name: 'scan.epub', mimeType: 'application/epub+zip', buffer: imageOnlyComic() })
  await expect(page.getByText('Đã thêm vào thư viện')).toBeVisible()
  await page.getByRole('button', { name: 'Về thư viện', exact: true }).click()
  await page.getByRole('button', { name: 'Đọc Những miền xanh', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Thêm bookmark', exact: true })).toBeEnabled()
  await expect.poll(() => page.locator('.page-slot').evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(390)
  const frame = page.frames().find(f => f.url().startsWith('blob:'))!
  const image = await frame.evaluate(() => {
    const rect = document.images[0].getBoundingClientRect()
    return { width: rect.width, height: rect.height, left: rect.left, top: rect.top }
  })
  expect(image).toEqual({ width: 600, height: 900, left: 0, top: 0 })
  await page.getByRole('button', { name: 'Thiết lập đọc', exact: true }).click()
  await page.getByLabel('Thu phóng', { exact: true }).fill('2')
  await expect(page.getByLabel('Thu phóng', { exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Đóng bảng', exact: true }).click()
  const surface = page.locator('.page-surface')
  await expect.poll(() => surface.evaluate(el => el.scrollWidth - el.clientWidth)).toBeGreaterThan(300)
  await surface.evaluate(el => { el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2 })
  await swipe(page, -150)
  await expect(page.locator('.reader-progress > span')).toHaveText('Trang 1')
  await surface.evaluate(el => { el.scrollLeft = el.scrollWidth })
  await swipe(page, -150)
  await expect(page.locator('.reader-progress > span')).toHaveText('Trang 2')
  await expect.poll(() => surface.evaluate(el => el.scrollLeft)).toBe(0)
  await swipe(page, 150)
  await expect(page.locator('.reader-progress > span')).toHaveText('Trang 1')
  // Vertical panning must not turn pages.
  const currentFrame = page.frames().find(f => f.url().startsWith('blob:'))!
  await currentFrame.evaluate(() => {
    for (const [type, y] of [['touchstart', 350], ['touchmove', 150], ['touchend', 150]] as const) {
      const point = { clientX: 300, clientY: y }
      const event = new Event(type, { bubbles: true })
      Object.defineProperties(event, { touches: { value: type === 'touchend' ? [] : [point] }, changedTouches: { value: [point] } })
      document.body.dispatchEvent(event)
    }
  })
  await expect(page.locator('.reader-progress > span')).toHaveText('Trang 1')
  await page.getByRole('button', { name: 'Thiết lập đọc', exact: true }).click()
  await page.getByLabel('Hướng lật trang', { exact: true }).selectOption('rtl')
  await expect(page.getByLabel('Hướng lật trang', { exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Đóng bảng', exact: true }).click()
  await surface.evaluate(el => { el.scrollLeft = -(el.scrollWidth - el.clientWidth) })
  // A pinch followed by lifting one finger must not become a page swipe.
  await page.evaluate(() => {
    const doc = document.querySelector<HTMLIFrameElement>('.page-content iframe')!.contentDocument!
    const a = { clientX: 100, clientY: 350 }, b = { clientX: 300, clientY: 350 }
    for (const [type, touches, changedTouches] of [
      ['touchstart', [a, b], [a, b]], ['touchend', [a], [b]],
      ['touchmove', [{ clientX: 300, clientY: 350 }], [a]], ['touchend', [], [b]],
    ] as const) {
      const event = new Event(type, { bubbles: true })
      Object.defineProperties(event, { touches: { value: touches }, changedTouches: { value: changedTouches } })
      doc.body.dispatchEvent(event)
    }
  })
  await expect(page.locator('.reader-progress > span')).toHaveText('Trang 1')
  await swipe(page, 150)
  await expect(page.locator('.reader-progress > span')).toHaveText('Trang 2')
  await swipe(page, -150)
  await expect(page.locator('.reader-progress > span')).toHaveText('Trang 1')
  expect(errors).toEqual([])
})
