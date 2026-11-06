import { test, expect, type Page } from '@playwright/test'
import { makeEPUB } from './fixtures'

async function menu(page: Page) {
  const button = page.getByRole('button', { name: 'Mở menu', exact: true })
  if (await button.isVisible()) await button.click()
}
test('bộ sưu tập, tìm kiếm, xuất ZIP và khôi phục vào trình duyệt sạch', async ({ page, browser }) => {
  await page.goto('/')
  await page.getByLabel('Chọn file sách', { exact: true }).setInputFiles({ name: 'sample.epub', mimeType: 'application/epub+zip', buffer: makeEPUB() })
  await expect(page.getByRole('heading', { name: 'Kết quả nhập sách' })).toBeVisible()
  await page.getByRole('button', { name: 'Về thư viện', exact: true }).click()
  await menu(page)
  await page.getByRole('button', { name: 'Tạo bộ sưu tập', exact: true }).last().click()
  await page.getByPlaceholder('Ví dụ: Những ngày đọc chậm').fill('Truyện của tôi')
  await page.getByRole('button', { name: 'Tạo bộ sưu tập', exact: true }).last().click()
  // Selecting a collection also collapses the mobile sidebar via the navigation control.
  const scrim = page.locator('.sidebar-scrim')
  if (await scrim.isVisible()) await scrim.click({ position: { x: 300, y: 400 } })
  await menu(page)
  await page.getByRole('navigation', { name: 'Thư viện', exact: true }).getByRole('button', { name: /Tất cả sách/ }).click()
  await page.getByRole('button', { name: 'Thông tin Một khoảng lặng', exact: true }).click()
  await page.getByLabel('Truyện của tôi', { exact: true }).click()
  await expect(page.getByLabel('Truyện của tôi', { exact: true })).toBeChecked()
  await page.getByRole('button', { name: 'Đóng', exact: true }).click()
  await page.getByRole('textbox', { name: 'Tìm sách', exact: true }).fill('không tồn tại')
  await expect(page.getByRole('heading', { name: 'Chưa tìm thấy cuốn sách này' })).toBeVisible()
  await page.getByRole('button', { name: 'Xóa tìm kiếm', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Đọc Một khoảng lặng', exact: true })).toBeVisible()
  await menu(page)
  await page.getByRole('button', { name: /đã lưu/ }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Xuất bản sao lưu ZIP', exact: true }).click()
  const backup = await downloadPromise
  const path = await backup.path()
  expect(path).toBeTruthy()
  // Restore checks need a clean database, not a second PWA installation.
  // Blocking service workers here also avoids a WebKit shutdown race while
  // that extra context is still precaching the app's offline assets.
  const clean = await browser.newContext({ serviceWorkers: 'block' })
  try {
    const restored = await clean.newPage()
    await restored.goto('http://localhost:4173/')
    await restored.getByLabel('Chọn bản sao lưu', { exact: true }).setInputFiles(path!)
    await expect(restored.getByRole('status')).toContainText('Đã khôi phục 1 sách mới')
    await expect(restored.getByLabel('Chọn bản sao lưu', { exact: true })).toHaveValue('')
    await expect(restored.getByRole('button', { name: 'Đọc Một khoảng lặng', exact: true })).toBeVisible()
    await expect(restored.getByRole('navigation', { name: 'Bộ sưu tập', exact: true }).getByRole('button', { name: /Truyện của tôi 1/ })).toBeVisible()
    await restored.getByLabel('Chọn bản sao lưu', { exact: true }).setInputFiles(path!)
    await expect(restored.getByRole('status')).toContainText('Đã khôi phục 0 sách mới')
  } finally { await clean.close() }
})
