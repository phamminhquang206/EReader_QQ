const READ_CHUNK_SIZE = 8 * 1024 * 1024

/** Read with bounded I/O requests while preserving the exact original bytes. */
export async function readBlobBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (blob.size <= READ_CHUNK_SIZE) return blob.arrayBuffer()
  const bytes = new Uint8Array(blob.size)
  for (let offset = 0; offset < blob.size; offset += READ_CHUNK_SIZE) {
    bytes.set(new Uint8Array(await blob.slice(offset, offset + READ_CHUNK_SIZE).arrayBuffer()), offset)
  }
  return bytes.buffer
}
