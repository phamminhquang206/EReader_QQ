import { test, expect, type Page } from '@playwright/test'
import { makeEPUB } from './fixtures'

async function openBook(page: Page, fixed: boolean) {
  await page.goto('/')
  await page.getByLabel('Chọn file sách', { exact: true }).setInputFiles({ name: 'transition.epub', mimeType: 'application/epub+zip', buffer: makeEPUB(fixed) })
  await expect(page.getByRole('heading', { name: 'Kết quả nhập sách' })).toBeVisible()
  await page.getByRole('button', { name: 'Về thư viện', exact: true }).click()
  await page.getByRole('button', { name: fixed ? 'Đọc Những miền xanh' : 'Đọc Một khoảng lặng', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Thêm bookmark', exact: true })).toBeEnabled()
}

test('truyện chuyển mềm 650ms, không nhảy trang khi bấm liên tiếp và hỗ trợ giảm chuyển động', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await openBook(page, true)
  await page.getByRole('button', { name: 'Thiết lập đọc', exact: true }).click()
  await page.getByLabel('Số trang trên màn hình rộng', { exact: true }).selectOption('none')
  await expect(page.getByLabel('Số trang trên màn hình rộng', { exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Đóng bảng', exact: true }).click()
  const surface = page.locator('.page-surface')
  const start = Date.now()
  await page.getByRole('button', { name: 'Trang sau', exact: true }).click({ clickCount: 3 })
  await expect(surface).toHaveAttribute('data-turning', 'true')
  const durations = await surface.evaluate(el => el.getAnimations().map(a => Number(a.effect?.getTiming().duration)))
  expect(durations.some(duration => duration >= 200)).toBe(true)
  await expect(surface).not.toHaveAttribute('data-turning')
  expect(Date.now() - start).toBeGreaterThanOrEqual(580)
  await expect(page.locator('.reader-progress > span')).toHaveText('Trang 2')
  await page.getByRole('button', { name: 'Trang trước', exact: true }).click()
  await expect(surface).not.toHaveAttribute('data-turning')
  await expect(page.locator('.reader-progress > span')).toHaveText('Trang 1')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('button', { name: 'Trang sau', exact: true }).click()
  await expect(page.locator('.reader-progress > span')).toHaveText('Trang 2')
  await expect(surface).not.toHaveAttribute('data-turning')
  expect(await surface.evaluate(el => el.getAnimations().length)).toBe(0)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.getByRole('button', { name: 'Trang sau', exact: true }).click()
  await page.getByRole('button', { name: 'Về thư viện', exact: true }).click()
  await page.waitForTimeout(750) // Observe beyond the cancelled 650 ms transition.
  expect(errors).toEqual([])
})

test('sách chữ trượt chậm và bỏ animation khi giảm chuyển động', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await openBook(page, false)
  const elapsed = await page.locator('foliate-view').evaluate(async element => {
    const view = element as HTMLElement & { renderer: HTMLElement; next: () => Promise<void> }
    if (!view.renderer.hasAttribute('animated')) throw new Error('Chưa bật chuyển trang mượt')
    const start = performance.now()
    await view.next()
    return performance.now() - start
  })
  expect(elapsed).toBeGreaterThanOrEqual(600)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const reduced = await page.locator('foliate-view').evaluate(async element => {
    const start = performance.now()
    await (element as HTMLElement & { next: () => Promise<void> }).next()
    return performance.now() - start
  })
  expect(reduced).toBeLessThan(450)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.getByRole('button', { name: 'Trang sau', exact: true }).click()
  await page.getByRole('button', { name: 'Về thư viện', exact: true }).click()
  await page.waitForTimeout(750) // A detached renderer must not report late scroll errors.
  expect(errors).toEqual([])
})
