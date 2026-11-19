// Turns the share card into a PNG for a chat. html-to-image draws the card's DOM (its inline SVG avatars too) and is
// only loaded when someone saves an image.

/** "squadsplit-team-lunch.png". */
export function imageFileName(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `squadsplit-${slug || 'quick-split'}.png`
}

/**
 * Draws `card` as a PNG. Where the phone can share files, it opens the share sheet; otherwise the PNG downloads.
 * Says which happened; 'cancelled' when the share sheet was closed.
 */
export async function saveCardImage(card: HTMLElement, title: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const { toBlob } = await import('html-to-image')
  const blob = await toBlob(card, { pixelRatio: 2, backgroundColor: '#fffaf6' })
  if (!blob) throw new Error("Couldn't draw the card. Try a screenshot instead.")
  const file = new File([blob], imageFileName(title), { type: 'image/png' })
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title })
      return 'shared'
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled'
      throw err
    }
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return 'downloaded'
}
