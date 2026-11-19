import type { ReceiptImageType } from '@squadsplit/shared'

const SIGNATURES: Record<ReceiptImageType, (b: Uint8Array) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x),
  'image/webp': (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP',
}

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to))

/**
 * Whether `base64` decodes to an image of the type the client says it is, judged by the file's first bytes.
 * Only the first few bytes are decoded; the image itself is never kept.
 */
export function isImageOfType(base64: string, mimeType: ReceiptImageType): boolean {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 !== 0) return false
  let head: Uint8Array
  try {
    head = Uint8Array.from(atob(base64.slice(0, 16)), (c) => c.charCodeAt(0))
  } catch {
    return false
  }
  return SIGNATURES[mimeType](head)
}
