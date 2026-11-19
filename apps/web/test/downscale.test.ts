import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { base64Of, downscaleImage, fitWithin, UnsupportedPhotoError } from '../src/receipt/downscale'

describe('fitWithin', () => {
  it('shrinks the long edge to the limit and keeps the aspect ratio', () => {
    expect(fitWithin(3024, 4032, 1024)).toEqual({ width: 768, height: 1024 })
    expect(fitWithin(4000, 1000, 1024)).toEqual({ width: 1024, height: 256 })
  })

  it('never scales a small image up', () => {
    expect(fitWithin(800, 600, 1024)).toEqual({ width: 800, height: 600 })
  })
})

describe('downscaleImage', () => {
  const undos: (() => void)[] = []
  /** Adds or replaces a property for one test. */
  function define(target: object, key: string, value: unknown) {
    const before = Object.getOwnPropertyDescriptor(target, key)
    Object.defineProperty(target, key, { configurable: true, writable: true, value })
    undos.push(() => (before ? Object.defineProperty(target, key, before) : delete (target as Record<string, unknown>)[key]))
  }
  const ctx = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() }
  let size = { w: 3024, h: 4032 }
  let decodes = true

  beforeEach(() => {
    size = { w: 3024, h: 4032 }
    decodes = true
    ctx.fillRect.mockClear()
    ctx.drawImage.mockClear()
    // jsdom has no object URLs and can't decode images, so these stand in for the browser's.
    define(URL, 'createObjectURL', vi.fn(() => 'blob:photo'))
    define(URL, 'revokeObjectURL', vi.fn())
    define(HTMLImageElement.prototype, 'decode', async () => {
      if (!decodes) throw new DOMException('The source image cannot be decoded.', 'EncodingError')
    })
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockImplementation(() => size.w)
    vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockImplementation(() => size.h)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ctx) as never)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function (this: HTMLCanvasElement, type, quality) {
      return `data:${type};base64,${this.width}x${this.height}@${quality}`
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    for (const undo of undos.splice(0)) undo()
  })

  it('redraws the photo at most 1024px on the long edge as a JPEG at quality 0.8, on white', async () => {
    const photo = new Blob(['jpeg bytes with EXIF'], { type: 'image/jpeg' })
    const out = await downscaleImage(photo, 1024)

    expect(out).toBe('data:image/jpeg;base64,768x1024@0.8')
    expect(ctx.fillStyle).toBe('#fff')
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 768, 1024)
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.any(HTMLImageElement), 0, 0, 768, 1024)
    expect(URL.createObjectURL).toHaveBeenCalledWith(photo)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:photo')
  })

  it('keeps a small photo at its own size', async () => {
    size = { w: 900, h: 400 }
    expect(await downscaleImage(new Blob(['x']), 1024)).toBe('data:image/jpeg;base64,900x400@0.8')
  })

  it('rejects a file the browser cannot decode with a friendly message, and still frees the object URL', async () => {
    decodes = false
    const failure = downscaleImage(new File(['heic bytes'], 'IMG_0043.HEIC', { type: 'image/heic' }), 1024)
    await expect(failure).rejects.toBeInstanceOf(UnsupportedPhotoError)
    await expect(failure).rejects.toThrow(
      "This photo format can't be read here — try a JPEG or PNG, or take the photo again with the camera button.",
    )
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:photo')
  })

  it('decodes a .jpeg with no MIME type: it goes by the pixels, not file.type', async () => {
    expect(await downscaleImage(new File(['jpeg bytes'], 'receipt.jpeg', { type: '' }), 1024)).toBe('data:image/jpeg;base64,768x1024@0.8')
  })

  it('base64Of drops the data URL prefix', () => {
    expect(base64Of('data:image/jpeg;base64,/9j/4AAQ')).toBe('/9j/4AAQ')
  })
})
