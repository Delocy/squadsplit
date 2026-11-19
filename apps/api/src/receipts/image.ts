import type { ReceiptImageType } from '@squadsplit/shared'

// Reads an image's type and size from its header, decoding only the few bytes it needs from the base64, so a
// 1.5 MB image costs microseconds. The image itself is never kept.

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

/** Decodes `length` bytes at byte `offset` of the base64 data; null if the data ends first. */
function bytesAt(b64: string, offset: number, length: number): Uint8Array | null {
  const start = Math.floor(offset / 3) * 4
  const end = Math.ceil((offset + length) / 3) * 4
  if (end > b64.length) return null
  const raw = atob(b64.slice(start, end))
  const skip = offset % 3
  if (raw.length < skip + length) return null
  return Uint8Array.from(raw.slice(skip, skip + length), (c) => c.charCodeAt(0))
}

const ascii = (b: Uint8Array) => String.fromCharCode(...b)
const be16 = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!
const be32 = (b: Uint8Array, i: number) => ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0
const le16 = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8)
const le24 = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16)

export interface ImageSize {
  width: number
  height: number
}

/** JPEG frame headers (SOF0–SOF15) that carry the size; C4, C8 and CC are other markers. */
const isFrameHeader = (marker: number) => marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc

function jpegSize(b64: string): ImageSize | null {
  const soi = bytesAt(b64, 0, 3)
  if (!soi || soi[0] !== 0xff || soi[1] !== 0xd8 || soi[2] !== 0xff) return null
  // Walk the segments (each "FF marker length") to the frame header; EXIF and other APPn segments come first.
  let offset = 2
  for (let segments = 0; segments < 100; segments++) {
    const seg = bytesAt(b64, offset, 4)
    if (!seg || seg[0] !== 0xff) return null
    const marker = seg[1]!
    if (marker === 0xff) {
      offset += 1 // fill byte
      continue
    }
    if (isFrameHeader(marker)) {
      const frame = bytesAt(b64, offset + 5, 4)
      return frame && { height: be16(frame, 0), width: be16(frame, 2) }
    }
    if (marker === 0xd9 || marker === 0xda) return null // end of image, or scan data, before any frame header
    offset += 2 + be16(seg, 2)
  }
  return null
}

function pngSize(b64: string): ImageSize | null {
  const head = bytesAt(b64, 0, 24)
  if (!head || ![0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => head[i] === x)) return null
  if (ascii(head.subarray(12, 16)) !== 'IHDR') return null
  return { width: be32(head, 16), height: be32(head, 20) }
}

function webpSize(b64: string): ImageSize | null {
  const riff = bytesAt(b64, 0, 16)
  if (!riff || ascii(riff.subarray(0, 4)) !== 'RIFF' || ascii(riff.subarray(8, 12)) !== 'WEBP') return null
  const chunk = ascii(riff.subarray(12, 16))
  const head = bytesAt(b64, 0, chunk === 'VP8L' ? 25 : 30)
  if (!head) return null
  switch (chunk) {
    case 'VP8 ': // lossy: the key frame's start code, then 14-bit width and height
      if (head[23] !== 0x9d || head[24] !== 0x01 || head[25] !== 0x2a) return null
      return { width: le16(head, 26) & 0x3fff, height: le16(head, 28) & 0x3fff }
    case 'VP8L': {
      // lossless: signature byte, then width-1 and height-1 in 14 bits each
      if (head[20] !== 0x2f) return null
      const bits = (head[21]! | (head[22]! << 8) | (head[23]! << 16) | (head[24]! << 24)) >>> 0
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
    }
    case 'VP8X': // extended: canvas width-1 and height-1 in 24 bits each
      return { width: le24(head, 24) + 1, height: le24(head, 27) + 1 }
    default:
      return null
  }
}

const READERS: Record<ReceiptImageType, (b64: string) => ImageSize | null> = {
  'image/jpeg': jpegSize,
  'image/png': pngSize,
  'image/webp': webpSize,
}

/**
 * The image's size, if `base64` is an image of the type the client says it is with a header we can read; null
 * otherwise (not base64, another type, or cut off before its size).
 */
export function imageSize(base64: string, mimeType: ReceiptImageType): ImageSize | null {
  if (base64.length % 4 !== 0 || !BASE64.test(base64)) return null
  try {
    return READERS[mimeType](base64)
  } catch {
    return null // atob refused a slice
  }
}
