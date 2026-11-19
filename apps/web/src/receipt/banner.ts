import { formatMoney, receiptChargesIncluded, type Currency } from '@squadsplit/shared'
import type { ReceiptScan } from './scanReceipt'

export const UNREADABLE_BANNER = "Couldn't read this receipt — add the items by hand."

/**
 * What the form says after a scan has filled in the items. The form adds the receipt's own service charge and GST
 * (see applyScan), unless the receipt's prices already include them, so when the items match the printed total, so
 * does the expense.
 */
export function scanBanner(scan: ReceiptScan, currency: Currency): string {
  const money = (cents: number) => formatMoney(cents, currency)
  if (scan.source === 'phone') return 'Read on your phone — double-check the items and prices.'
  if (scan.totalCents === null || scan.totalMatches === null) return 'Read your receipt — tap who had what.'
  if (scan.totalMatches && receiptChargesIncluded(scan)) {
    return `Read your receipt — total ${money(scan.totalCents)} matches (prices already include the charges). Tap who had what.`
  }
  if (scan.totalMatches) return `Read your receipt — total ${money(scan.totalCents)} matches. Tap who had what.`
  // How far off the items are is said once, at the total (see TotalFixup).
  return 'Read your receipt — check the total below, then tap who had what.'
}
