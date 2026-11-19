import { formatMoney, type PublicQuickSplitDTO, type QuickSplitDish } from '@squadsplit/shared'

// Words and numbers for a quick split, shared by the share card, its plain text, the public page and the history.

/** What the card and the public page need: the owner's QuickSplitDTO and the PublicQuickSplitDTO both fit. */
export type SplitView = Omit<PublicQuickSplitDTO, 'payerName'>

export const money = (s: Pick<SplitView, 'currency'>, cents: number) => formatMoney(cents, s.currency)

export const payerOf = (s: SplitView) => s.people.find((p) => p.id === s.payerId)!

/** Everyone who owes the payer, in the order entered. */
export const guestsOf = (s: SplitView) => s.people.filter((p) => p.id !== s.payerId)

/** Today as YYYY-MM-DD, in the viewer's own time zone. */
export const localToday = () => new Date().toLocaleDateString('en-CA')

/** "Thu 19 Nov" for a YYYY-MM-DD day, whatever the time zone. */
export function dayLabel(spentOn: string): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${spentOn}T00:00:00Z`))
    .replace(',', '')
}

/** "2:14pm", in the viewer's own time. */
export function clockTime(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(iso)).replace(/\s/g, '').toLowerCase()
}

/** "Satay ÷3" for a shared dish, the plain name for one person's. */
export const dishLabel = (d: QuickSplitDish) => (d.sharedBy === 1 ? d.name : `${d.name} ÷${d.sharedBy}`)

/** "10%", "7.5%". */
export const percent = (bps: number) => `${bps / 100}%`

/** What each person's dishes are multiplied by, written exactly: 1.199 for 10% then 9%. Integer maths only. */
export function multiplier(serviceChargeBps: number, gstBps: number): string {
  const scaled = (10_000 + serviceChargeBps) * (10_000 + gstBps) // × 1e8
  const frac = String(scaled % 100_000_000).padStart(8, '0').replace(/0+$/, '')
  return frac ? `${Math.floor(scaled / 100_000_000)}.${frac}` : String(Math.floor(scaled / 100_000_000))
}

const hasCharges = (s: SplitView) => s.serviceChargeBps > 0 || s.gstBps > 0

/** "Dishes $92.10 + 10% service $9.21 + 9% GST $9.12 = $110.43", naming only the charges that are on. */
export function chargesMath(s: SplitView): string {
  if (!hasCharges(s)) return `Dishes ${money(s, s.subtotalCents)}, no service charge or GST`
  const parts = [
    `Dishes ${money(s, s.subtotalCents)}`,
    s.serviceChargeBps > 0 && `${percent(s.serviceChargeBps)} service ${money(s, s.serviceChargeCents)}`,
    s.gstBps > 0 && `${percent(s.gstBps)} GST ${money(s, s.gstCents)}`,
  ]
  return `${parts.filter(Boolean).join(' + ')} = ${money(s, s.totalCents)}`
}

/** "Each total is that person's dishes × 1.199." or null with no charges. */
export function multiplierNote(s: SplitView): string | null {
  return hasCharges(s) ? `Each total is that person’s dishes × ${multiplier(s.serviceChargeBps, s.gstBps)}.` : null
}

/** "Incl. 10% service, then 9% GST (dishes x 1.199)." or null with no charges. */
function chargesSentence(s: SplitView): string | null {
  if (!hasCharges(s)) return null
  const named = [s.serviceChargeBps > 0 && `${percent(s.serviceChargeBps)} service`, s.gstBps > 0 && `${percent(s.gstBps)} GST`]
  return `Incl. ${named.filter(Boolean).join(', then ')} (dishes x ${multiplier(s.serviceChargeBps, s.gstBps)}).`
}

/** "Team lunch, Tanjong Pagar". */
export const titleWithPlace = (s: Pick<SplitView, 'title' | 'place'>) => (s.place ? `${s.title}, ${s.place}` : s.title)

/** The share card as plain text for a chat (mockup 5b), ending with the link (none once sharing has stopped). */
export function shareCardText(s: SplitView, link: string | null): string {
  const payer = payerOf(s)
  const people = s.people.flatMap((p) => {
    const head = `${p.name}: ${money(s, p.totalCents)}${p.id === s.payerId ? ' (paid)' : ''}`
    return p.dishes.length ? [head, `  ${p.dishes.map(dishLabel).join(', ')}`] : [head]
  })
  const charges = chargesSentence(s)
  return [
    `${titleWithPlace(s)} (${dayLabel(s.spentOn)})`,
    `${payer.name} paid ${money(s, s.totalCents)}`,
    '',
    ...people,
    '',
    ...(charges ? [charges] : []),
    `Pay ${payer.name}: ${guestsOf(s).map((p) => `${p.name} ${money(s, p.totalCents)}`).join(', ')}`,
    ...(link ? [`Tick when you've paid: ${link}`] : []),
  ].join('\n')
}

/** The full share link for a token, on this site. */
export const shareUrl = (token: string) => `${window.location.origin}/s/${token}`

/** The link without "https://", as the card prints it. */
export const shortLink = (url: string) => url.replace(/^https?:\/\//, '')
