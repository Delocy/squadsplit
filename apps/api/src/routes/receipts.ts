import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { ScanReceiptInput, receiptTotalMatches, type ReceiptScanDTO } from '@squadsplit/shared'
import { requireMember } from '../access'
import { db } from '../db'
import type { AppEnv } from '../env'
import { HttpError, parseBody, payloadTooLarge } from '../errors'
import { RECEIPT_MAX_IMAGE_EDGE, RECEIPT_SCAN_BODY_LIMIT } from '../receipts/config'
import { imageSize } from '../receipts/image'
import { refundScan, takeScan, utcDay } from '../receipts/quota'
import { ScanUnavailable, readReceipt } from '../receipts/read'

export const RECEIPT_SCAN_PATH = /^\/groups\/[^/]+\/receipts\/scan$/

const SCAN_LIMIT_MESSAGE = 'Receipt scanning is resting until tomorrow — enter the items by hand.'

/**
 * POST /groups/:id/receipts/scan: reads a receipt photo into items for the itemized form. It never creates an
 * expense, and the image is neither stored nor logged.
 */
export function receiptRoutes() {
  return new Hono<AppEnv>().post(
    '/:id/receipts/scan',
    bodyLimit({ maxSize: RECEIPT_SCAN_BODY_LIMIT, onError: payloadTooLarge }),
    async (c) => {
      const userId = c.var.userId
      await requireMember(db(c.env), c.req.param('id'), userId)
      const image = await parseBody(c, ScanReceiptInput)
      const size = imageSize(image.imageBase64, image.mimeType)
      if (!size) throw new HttpError(422, 'not_an_image', 'That file is not a JPEG, PNG or WebP image.')
      if (size.width > RECEIPT_MAX_IMAGE_EDGE || size.height > RECEIPT_MAX_IMAGE_EDGE) {
        throw new HttpError(422, 'image_too_large', `Send a photo at most ${RECEIPT_MAX_IMAGE_EDGE} pixels on each side.`)
      }

      // Counted before the model runs, so parallel scans can't overshoot. Given back only when the model never
      // answered: an answer, readable or not, has used neurons.
      const day = utcDay()
      if (!(await takeScan(c.env.DB, userId, day))) throw new HttpError(429, 'scan_limit', SCAN_LIMIT_MESSAGE)

      let read
      try {
        read = await readReceipt(c.env.AI, image)
      } catch (err) {
        if (!(err instanceof ScanUnavailable)) throw err
        await refundScan(c.env.DB, userId, day)
        console.warn('receipt scan failed:', err.reason)
        if (err.reason === 'ai_quota') throw new HttpError(429, 'scan_limit', SCAN_LIMIT_MESSAGE)
        throw new HttpError(503, 'scan_unavailable', "Receipt scanning isn't available right now.")
      }
      if ('unreadable' in read) {
        if (read.unreadable === 'unparseable') console.warn('receipt scan failed:', read.unreadable)
        throw new HttpError(422, 'receipt_unreadable', "Couldn't read this receipt — add the items by hand.")
      }

      const body: ReceiptScanDTO = { ...read.receipt, totalMatches: receiptTotalMatches(read.receipt), source: 'ai' }
      return c.json(body)
    },
  )
}
