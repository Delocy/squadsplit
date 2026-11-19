import { normalizeReceiptScan, type ReceiptScanResult } from '@squadsplit/shared'

// Turns the text read on the phone (Tesseract OCR) into receipt items, for when the AI scan isn't available.
// Pure and line-based: Singapore receipts put each amount at the end of its line.

/** An amount at the end of a line: "10.00", "$12,00", "S$ 7.50", "-$0.03". */
const END_AMOUNT = /(-)?\s*(?:S?\$)?\s*(\d{1,6})[.,](\d{2})\s*$/
const PERCENT = /(\d{1,2}(?:\.\d{1,2})?)\s*%/

const SUBTOTAL = /sub[\s-]*total/i
const TOTAL = /total/i
const SERVICE = /\bservice\b|\bsvc\b|\bs\/c\b/i
const GST = /\bgst\b|\btax\b/i
const INCLUDED = /\bincl/i
/** Payment, change and other lines that are never items. */
const NOT_AN_ITEM =
  /\b(cash|change|nets|visa|master(card)?|amex|card|paynow|payment|paid|tender(ed)?|rounding|round|balance|due|tips?|discount|voucher|deposit|qty)\b/i

interface Amount {
  cents: number
  negative: boolean
  /** The line without the amount. */
  label: string
}

function endAmount(line: string): Amount | null {
  const m = END_AMOUNT.exec(line)
  if (!m) return null
  return { cents: Number(m[2]) * 100 + Number(m[3]), negative: m[1] === '-', label: line.slice(0, m.index).trimEnd() }
}

/** "10%" in the label as basis points, or null. */
function percentBps(label: string): number | null {
  const m = PERCENT.exec(label)
  return m ? Math.round(Number(m[1]) * 100) : null
}

/** The rate a charge must be, to the nearest whole percent, from its amount and what it was charged on. */
const inferBps = (amount: number, base: number) => (base > 0 ? Math.round((amount / base) * 100) * 100 : null)

/** An item's name and quantity from the text left of its line total. */
function itemOf(label: string): { name: string; qty: number } | null {
  let rest = label
  let qty = 1
  // "Flat White  2  5.50" (quantity and unit price columns): drop the unit price, then read the quantity.
  const unit = endAmount(rest)
  if (unit) {
    rest = unit.label
    const q = /\s(\d{1,2})$/.exec(rest)
    if (q) {
      qty = Number(q[1])
      rest = rest.slice(0, q.index)
    }
  }
  // "2 x Teh Tarik", "2 Teh Tarik"
  const lead = /^\s*(\d{1,2})\s*[xX*@×]?\s+(?=\D)/.exec(rest)
  if (lead) {
    qty = Number(lead[1])
    rest = rest.slice(lead[0].length)
  }
  // "Steamed Rice x3", "Lime Juice x 3"
  const trail = /\s[xX×]\s*(\d{1,2})\s*$/.exec(rest)
  if (trail) {
    qty = Number(trail[1])
    rest = rest.slice(0, trail.index)
  }
  const name = rest
    .replace(/[|_~]/g, ' ')
    .replace(/^[^\p{L}\p{N}(]+|[^\p{L}\p{N})]+$/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!/\p{L}.*\p{L}/u.test(name)) return null
  return { name: qty > 1 ? `${name} x${qty}` : name, qty }
}

/**
 * Reads OCR text from a receipt into items (line totals, quantity lines merged into one item), the service charge
 * and GST rates (printed, or worked out from their amounts) and the total. Skips subtotal, payment, change and
 * rounding lines, and GST that prices already include. Null when no line looks like an item.
 */
export function parseReceiptText(text: string): ReceiptScanResult | null {
  const items: { name: string; amountCents: number }[] = []
  let total: number | null = null
  let service: { bps: number | null; cents: number } | null = null
  let gst: { bps: number | null; cents: number } | null = null

  for (const line of text.split(/\r?\n/)) {
    const amount = endAmount(line)
    if (!amount) continue
    const { label, cents, negative } = amount
    if (SUBTOTAL.test(label)) continue
    if (TOTAL.test(label)) {
      if (!negative) total = Math.max(total ?? 0, cents)
    } else if (SERVICE.test(label)) {
      service = { bps: percentBps(label), cents }
    } else if (GST.test(label)) {
      if (!INCLUDED.test(label)) gst = { bps: percentBps(label), cents }
    } else if (!NOT_AN_ITEM.test(label) && !negative) {
      const item = itemOf(label)
      if (item) items.push({ name: item.name, amountCents: cents })
    }
  }

  const subtotal = items.reduce((sum, it) => sum + it.amountCents, 0)
  const serviceBps = service ? (service.bps ?? inferBps(service.cents, subtotal)) : null
  const gstBase = subtotal + (service?.cents ?? 0)
  const gstBps = gst ? (gst.bps ?? inferBps(gst.cents, gstBase)) : null

  return normalizeReceiptScan({ items, serviceChargeBps: serviceBps, gstBps, totalCents: total })
}
