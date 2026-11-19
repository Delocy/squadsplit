import { receiptTotalMatches, type ReceiptScanDTO, type ReceiptScanResult } from '@squadsplit/shared'
import { ApiError, type ApiClient } from '../api'
import { OCR_MAX_EDGE, SCAN_MAX_EDGE, base64Of, downscaleImage } from './downscale'
import { readTextOnPhone } from './ocr'
import { parseReceiptText } from './parseReceiptText'

/** A receipt read into items, by the AI scan or, as a fallback, on the phone. */
export interface ReceiptScan extends ReceiptScanResult {
  totalMatches: boolean | null
  source: 'ai' | 'phone'
}

export type ScanOutcome = { kind: 'scanned'; scan: ReceiptScan } | { kind: 'unreadable' }

const UNREADABLE: ScanOutcome = { kind: 'unreadable' }

/** Over the daily limit (429), down (5xx) or unreachable: the phone can still try. */
const phoneCanTry = (err: unknown) => err instanceof ApiError && (err.status === 0 || err.status === 429 || err.status >= 500)

/**
 * Reads a receipt photo: shrinks it on the phone, sends it to the AI scan, and falls back to reading it on the phone
 * when the scan is resting, down or unreachable. Never creates an expense. Other API errors (e.g. no longer a
 * member) are thrown.
 */
export async function scanReceipt(api: ApiClient, groupId: string, file: Blob): Promise<ScanOutcome> {
  let small: string
  try {
    small = await downscaleImage(file, SCAN_MAX_EDGE)
  } catch {
    return UNREADABLE // not an image the browser can open
  }
  try {
    const scan = await api.post<ReceiptScanDTO>(`/groups/${groupId}/receipts/scan`, {
      imageBase64: base64Of(small),
      mimeType: 'image/jpeg',
    })
    return { kind: 'scanned', scan }
  } catch (err) {
    if (err instanceof ApiError && err.code === 'receipt_unreadable') return UNREADABLE
    if (!phoneCanTry(err)) throw err
  }
  return readOnPhone(file)
}

async function readOnPhone(file: Blob): Promise<ScanOutcome> {
  let text: string
  try {
    text = await readTextOnPhone(await downscaleImage(file, OCR_MAX_EDGE))
  } catch {
    return UNREADABLE
  }
  const result = parseReceiptText(text)
  return result ? { kind: 'scanned', scan: { ...result, totalMatches: receiptTotalMatches(result), source: 'phone' } } : UNREADABLE
}
