import { z } from 'zod'
import { itemizedTotal } from './itemized'
import type { Cents } from './money'

// Receipt scanning: the request body, the shape a scan is cleaned into, and the total cross-check.
// The API uses these for the AI's answer; the web app uses them for the on-phone (OCR) fallback.

export const RECEIPT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type ReceiptImageType = (typeof RECEIPT_IMAGE_TYPES)[number]

/** The largest receipt image the API takes, decoded. The web app sends far less (a 1024px JPEG, usually under 600 KB). */
export const MAX_RECEIPT_IMAGE_BYTES = 1.5 * 1024 * 1024
export const MAX_RECEIPT_ITEMS = 50
export const MAX_RECEIPT_ITEM_NAME = 60

const MAX_CENTS = 100_000_000
const MAX_BPS = 3000

/** `POST /groups/:id/receipts/scan` body: the image as plain base64 (no `data:` prefix). */
export const ScanReceiptInput = z.object({
  imageBase64: z
    .string()
    .min(1)
    .max(Math.ceil(MAX_RECEIPT_IMAGE_BYTES / 3) * 4, { message: 'Image must be 1.5 MB or smaller' }),
  mimeType: z.enum(RECEIPT_IMAGE_TYPES),
})
export type ScanReceiptInput = z.infer<typeof ScanReceiptInput>

const cents = z.number().int().min(1).max(MAX_CENTS)
const bps = z.number().int().min(0).max(MAX_BPS)

/** A receipt read into items, with the charges and total it shows (null when the receipt doesn't show them). */
export const ReceiptScanResult = z.object({
  items: z
    .array(z.object({ name: z.string().min(1).max(MAX_RECEIPT_ITEM_NAME), amountCents: cents }))
    .min(1)
    .max(MAX_RECEIPT_ITEMS),
  serviceChargeBps: bps.nullable(),
  gstBps: bps.nullable(),
  totalCents: cents.nullable(),
})
export type ReceiptScanResult = z.infer<typeof ReceiptScanResult>

/** `POST /groups/:id/receipts/scan` 200 response. `totalMatches` is null when the receipt shows no total. */
export interface ReceiptScanDTO extends ReceiptScanResult {
  totalMatches: boolean | null
  source: 'ai'
}

const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/gu

/** A whole number from a number or a numeric string, rounded; anything else is null. */
function wholeNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? Math.round(n) : null
}

const inRange = (n: number | null, min: number, max: number) => (n !== null && n >= min && n <= max ? n : null)

/**
 * Cleans a scan answer we don't trust (the AI's JSON) into a ReceiptScanResult: names trimmed and cut to 60
 * characters, amounts rounded to whole cents, items without a usable name or amount dropped, at most 50 items,
 * and charges or a total outside their range read as unknown. Null when no item survives.
 */
export function normalizeReceiptScan(raw: unknown): ReceiptScanResult | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.items)) return null

  const items: ReceiptScanResult['items'] = []
  for (const it of r.items) {
    if (items.length >= MAX_RECEIPT_ITEMS) break
    if (typeof it !== 'object' || it === null) continue
    const { name, amountCents } = it as Record<string, unknown>
    if (typeof name !== 'string') continue
    const clean = name.replace(CONTROL_OR_FORMAT, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_RECEIPT_ITEM_NAME).trim()
    const amount = inRange(wholeNumber(amountCents), 1, MAX_CENTS)
    if (clean && amount !== null) items.push({ name: clean, amountCents: amount })
  }
  if (!items.length) return null

  return ReceiptScanResult.parse({
    items,
    serviceChargeBps: inRange(wholeNumber(r.serviceChargeBps), 0, MAX_BPS),
    gstBps: inRange(wholeNumber(r.gstBps), 0, MAX_BPS),
    totalCents: inRange(wholeNumber(r.totalCents), 1, MAX_CENTS),
  })
}

/** The items plus the receipt's own service charge and GST (none when it shows none), as the itemized split works it out. */
export function receiptItemsTotal(r: ReceiptScanResult): Cents {
  return itemizedTotal({
    items: r.items.map((it) => ({ ...it, userIds: [] })),
    serviceChargeBps: r.serviceChargeBps ?? 0,
    gstBps: r.gstBps ?? 0,
  })
}

/**
 * A receipt rounds its service charge and its GST lines to the cent separately, so its total can be up to a cent
 * away from ours for each of them.
 */
const ROUNDING_SLACK_CENTS = 2

/** Whether the items add up to the printed total; null when the receipt shows none. */
export function receiptTotalMatches(r: ReceiptScanResult): boolean | null {
  if (r.totalCents === null) return null
  return Math.abs(receiptItemsTotal(r) - r.totalCents) <= ROUNDING_SLACK_CENTS
}
