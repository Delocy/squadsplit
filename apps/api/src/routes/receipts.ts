import { Hono } from 'hono'
import { ScanReceiptInput, receiptTotalMatches, type ReceiptScanDTO } from '@squadsplit/shared'
import { requireMember } from '../access'
import { db } from '../db'
import type { AppEnv } from '../env'
import { HttpError, parseBody } from '../errors'
import { isImageOfType } from '../receipts/image'
import { refundScan, takeScan, utcDay } from '../receipts/quota'
import { ScanUnavailable, readReceipt } from '../receipts/read'

/**
 * POST /groups/:id/receipts/scan: reads a receipt photo into items for the itemized form. It never creates an
 * expense, and the image is neither stored nor logged.
 */
export function receiptRoutes() {
  return new Hono<AppEnv>().post('/:id/receipts/scan', async (c) => {
    const userId = c.var.userId
    await requireMember(db(c.env), c.req.param('id'), userId)
    const image = await parseBody(c, ScanReceiptInput)
    if (!isImageOfType(image.imageBase64, image.mimeType)) {
      throw new HttpError(422, 'not_an_image', 'That file is not a JPEG, PNG or WebP image.')
    }

    // Counted before the model runs, so parallel scans can't overshoot; given back if the failure is ours.
    const day = utcDay()
    if (!(await takeScan(c.env.DB, userId, day))) {
      throw new HttpError(429, 'scan_limit', 'Receipt scanning is resting until tomorrow — enter the items by hand.')
    }

    let result
    try {
      result = await readReceipt(c.env.AI, image)
    } catch (err) {
      if (!(err instanceof ScanUnavailable)) throw err
      await refundScan(c.env.DB, userId, day)
      console.warn('receipt scan failed:', err.reason)
      throw new HttpError(503, 'scan_unavailable', "Receipt scanning isn't available right now.")
    }
    if (!result) throw new HttpError(422, 'receipt_unreadable', "Couldn't read this receipt — add the items by hand.")

    const body: ReceiptScanDTO = { ...result, totalMatches: receiptTotalMatches(result), source: 'ai' }
    return c.json(body)
  })
}
