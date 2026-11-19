import { formatMoney, receiptItemsTotal, type Currency } from '@squadsplit/shared'
import type { ReceiptScan } from './scanReceipt'

export const UNREADABLE_BANNER = "Couldn't read this receipt — add the items by hand."

/**
 * What the form says after a scan has filled in the items. The form adds the receipt's own service charge and GST
 * (see applyScan), so when the items match the printed total, so does the expense.
 */
export function scanBanner(scan: ReceiptScan, currency: Currency): string {
  const money = (cents: number) => formatMoney(cents, currency)
  if (scan.source === 'phone') return 'Read on your phone — double-check the items and prices.'
  if (scan.totalCents === null || scan.totalMatches === null) return 'Read your receipt — tap who had what.'
  if (scan.totalMatches) return `Read your receipt — total ${money(scan.totalCents)} matches. Tap who had what.`
  return `Receipt says ${money(scan.totalCents)}, items add up to ${money(receiptItemsTotal(scan))} — please check the items.`
}
