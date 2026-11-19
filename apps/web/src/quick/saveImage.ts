// Turns the share card into a PNG for a chat. html-to-image draws the card's DOM (its inline SVG avatars too) and is
// only loaded when a card is on screen.
//
// The PNG is drawn ahead of time (see ShareCardWithActions), so a tap on Save image can open the share sheet at once:
// phones only allow navigator.share inside the tap, and drawing first would use that moment up.

/** "squadsplit-team-lunch.png". */
export function imageFileName(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `squadsplit-${slug || 'quick-split'}.png`
}

/** Draws `card` as a PNG file. Rejects if it can't be drawn. */
export async function renderCardImage(card: HTMLElement, title: string): Promise<File> {
  const { toBlob } = await import('html-to-image')
  const blob = await toBlob(card, { pixelRatio: 2, backgroundColor: '#fffaf6' })
  if (!blob) throw new Error('No image')
  return new File([blob], imageFileName(title), { type: 'image/png' })
}

function download(file: File) {
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Hands the PNG over: the share sheet where the phone can share files, else a download. navigator.share is called
 * before anything is awaited, so it runs inside the tap. If the share sheet is refused for any reason but being
 * closed, the PNG downloads instead. Says which happened.
 */
export async function deliverCardImage(file: File, title: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title })
      return 'shared'
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled'
    }
  }
  download(file)
  return 'downloaded'
}
