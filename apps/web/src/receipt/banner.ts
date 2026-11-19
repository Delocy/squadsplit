import { formatMoney, receiptItemsTotal, type Currency } from '@squadsplit/shared'
import { isSgRestaurantBill } from '../expenseDraft'
import type { ReceiptScan } from './scanReceipt'

export const UNREADABLE_BANNER = "Couldn't read this receipt — add the items by hand."

const OTHER_CHARGES =
  "Its charges aren't the usual 10% service charge and 9% GST, so the restaurant bill toggle is off."

/** What the form says after a scan has filled in the items. */
export function scanBanner(scan: ReceiptScan, currency: Currency): string {
  const money = (cents: number) => formatMoney(cents, currency)
  let text: string
  if (scan.source === 'phone') text = 'Read on your phone — double-check the items and prices.'
  else if (scan.totalCents === null || scan.totalMatches === null) text = 'Read your receipt — tap who had what.'
  else if (scan.totalMatches) text = `Read your receipt — total ${money(scan.totalCents)} matches. Tap who had what.`
  else text = `Receipt says ${money(scan.totalCents)}, items add up to ${money(receiptItemsTotal(scan))} — please check the items.`

  const hasCharges = (scan.serviceChargeBps ?? 0) > 0 || (scan.gstBps ?? 0) > 0
  return hasCharges && !isSgRestaurantBill(scan) ? `${text} ${OTHER_CHARGES}` : text
}
