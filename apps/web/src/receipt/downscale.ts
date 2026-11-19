// Shrinks a receipt photo on the phone before it goes anywhere. Redrawing it on a canvas and re-encoding it as
// JPEG keeps only the pixels, so EXIF data (GPS position, camera, time) never leaves the device.

/** The long edge sent to the AI scan: enough to read a receipt, and small enough to upload quickly. */
export const SCAN_MAX_EDGE = 1024
/** On-phone OCR reads small print better from a bigger image. */
export const OCR_MAX_EDGE = 2048
const JPEG_QUALITY = 0.8

/** The size that fits within `maxEdge` on the long edge, keeping the aspect ratio; never scaled up. */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/**
 * A photo the browser can't decode, like an iPhone HEIC photo in desktop Chrome. Its message is shown as it is.
 */
export class UnsupportedPhotoError extends Error {
  constructor() {
    super("This photo format can't be read here — try a JPEG or PNG, or take the photo again with the camera button.")
    this.name = 'UnsupportedPhotoError'
  }
}

/**
 * Decodes the photo. Browsers apply its EXIF orientation when drawing an <img>, so the receipt comes out upright.
 * Whether it is a photo is decided by decoding it, never by `file.type`: some pickers give no MIME type at all.
 */
async function loadImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    try {
      await img.decode()
    } catch {
      throw new UnsupportedPhotoError()
    }
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * The photo redrawn at most `maxEdge` pixels on its long edge, as a JPEG data URL (quality 0.8, white behind any
 * transparency). Rejects with UnsupportedPhotoError when the browser can't decode the file.
 */
export async function downscaleImage(file: Blob, maxEdge: number): Promise<string> {
  const img = await loadImage(file)
  const { width, height } = fitWithin(img.naturalWidth, img.naturalHeight, maxEdge)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not available')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(img, 0, 0, width, height)
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY)
}

/** The base64 part of a data URL. */
export const base64Of = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(',') + 1)
