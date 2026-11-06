import { expect, it, vi } from 'vitest'
import { readBlobBuffer } from '../src/blob'

it('đọc file lớn theo khối, không gọi arrayBuffer trên toàn file', async () => {
  const bytes = new Uint8Array(9 * 1024 * 1024 + 3)
  bytes[0] = 17; bytes[8 * 1024 * 1024] = 29; bytes[bytes.length - 1] = 83
  const blob = new Blob([bytes])
  const whole = vi.spyOn(blob, 'arrayBuffer').mockRejectedValue(new DOMException('File too large', 'NotFoundError'))
  const read = new Uint8Array(await readBlobBuffer(blob))
  expect(whole).not.toHaveBeenCalled()
  expect(Buffer.compare(Buffer.from(read), Buffer.from(bytes))).toBe(0)
})
