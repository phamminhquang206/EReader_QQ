import { test, expect } from '@playwright/test'
import { makeAZW3 } from './fixtures'

test('AZW3/KF8: nhập, đọc tiếng Việt, đánh dấu, ghi chú và tiếp tục offline', async ({ page, context }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const data = makeAZW3()
  expect(data.readUInt32BE(data.readUInt32BE(78) + 36)).toBe(8)
  await page.goto('/')
  await expect(page.getByLabel('Chọn file sách', { exact: true })).not.toHaveAttribute('accept')
  await page.getByLabel('Chọn file sách', { exact: true }).setInputFiles({ name: 'sach.AZW3', mimeType: 'application/vnd.amazon.mobi8-ebook', buffer: data })
  await expect(page.getByRole('heading', { name: 'Kết quả nhập sách' })).toBeVisible()
  await expect(page.getByText('Đã thêm vào thư viện')).toBeVisible()
  await page.getByRole('button', { name: 'Về thư viện', exact: true }).click()
  await expect(page.locator('.book-card .format-tag')).toHaveText('AZW3')
  await page.getByRole('button', { name: 'Đọc Một cuốn sách AZW3', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Thêm bookmark', exact: true })).toBeEnabled()
  const frame = page.frames().find(f => f.url().startsWith('blob:'))!
  await expect(frame.locator('h1')).toHaveText('Chương 1')
  await expect(frame.locator('p').first()).toContainText('Đọc sách AZW3 bằng tiếng Việt')
  await page.getByRole('button', { name: 'Thêm bookmark', exact: true }).click()
  await frame.evaluate(() => {
    const text = document.querySelector('p')!.firstChild!
    const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 25)
    const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })
  await page.getByRole('button', { name: 'Ghi chú đoạn đã chọn', exact: true }).click()
  await page.getByPlaceholder('Điều bạn muốn ghi nhớ…').fill('Ghi chú trong AZW3')
  await page.getByRole('button', { name: 'Lưu ghi chú', exact: true }).click()
  await expect(page.getByPlaceholder('Điều bạn muốn ghi nhớ…')).toHaveCount(0)
  await page.getByRole('slider', { name: 'Tiến độ đọc' }).fill('1000')
  await expect.poll(async () => {
    const current = page.frames().find(f => f.url().startsWith('blob:'))
    try { return await current?.locator('h1').textContent() } catch { return '' }
  }).toBe('Chương 2')
  await expect.poll(async () => page.locator('foliate-view').evaluate(element =>
    (element as HTMLElement & { lastLocation?: { cfi: string } }).lastLocation?.cfi ?? '')).toMatch(/^epubcfi\(\/6\/4/)
  const chapter = page.frames().find(f => f.url().startsWith('blob:'))!
  await chapter.evaluate(async () => {
    await document.fonts.ready
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  })
  const position = await page.getByRole('slider', { name: 'Tiến độ đọc' }).inputValue()
  await page.getByRole('button', { name: 'Về thư viện', exact: true }).click()
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await context.setOffline(true)
  await page.reload()
  await page.getByRole('button', { name: 'Đọc Một cuốn sách AZW3', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Thêm bookmark', exact: true })).toBeEnabled()
  await expect(page.getByRole('slider', { name: 'Tiến độ đọc' })).toHaveValue(position)
  await page.getByRole('button', { name: 'Bookmark và ghi chú', exact: true }).click()
  await expect(page.locator('.annotation')).toHaveCount(2)
  await expect(page.locator('.annotation').getByText('Ghi chú trong AZW3', { exact: true })).toBeVisible()
  expect(errors).toEqual([])
})
