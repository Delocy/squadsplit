import { normalizeReceiptScan, type ReceiptScanResult, type ScanReceiptInput } from '@squadsplit/shared'
import { RECEIPT_MAX_TOKENS, RECEIPT_MODEL } from './config'

/** Why a scan could not be done on our side. Only this code is ever logged, never the image or the answer. */
export type ScanFailure = 'ai_error' | 'unparseable'

export class ScanUnavailable extends Error {
  constructor(readonly reason: ScanFailure) {
    super(`Receipt scan unavailable: ${reason}`)
    this.name = 'ScanUnavailable'
  }
}

const SYSTEM_PROMPT = `You read photos of receipts from Singapore restaurants, hawker stalls and shops.
Reply with one JSON object and nothing else: no words before or after it, no code fences.
The object has exactly this shape:
{"items":[{"name":string,"amountCents":integer}],"serviceChargeBps":integer|null,"gstBps":integer|null,"totalCents":integer|null}
Rules:
- Money is in cents, as whole numbers: $12.50 is 1250.
- One item per ordered line, with that line's total. A line with a quantity, like "2 x Teh Tarik 4.40", is one item named "Teh Tarik x2" with amountCents 440.
- Item names as printed, short (at most 60 characters).
- Never list these as items: subtotal, service charge, GST, tax, rounding, discounts, total, amount paid, cash, card, NETS, PayNow, change, tips.
- serviceChargeBps: the service charge rate in basis points (10% is 1000), or null if there is none.
- gstBps: the GST rate in basis points (9% is 900), or null if there is none or prices already include it.
- totalCents: the final amount to pay, or null if you cannot see it.
- If this is not a receipt or you cannot read any items, reply {"items":[],"serviceChargeBps":null,"gstBps":null,"totalCents":null}.`

/**
 * The first JSON object in the model's text: it sometimes wraps the answer in a code fence or adds a sentence.
 * Tries each "{" in turn and returns the first balanced object that parses.
 */
export function firstJsonObject(text: string): unknown {
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    const end = matchingBrace(text, start)
    if (end === -1) return undefined
    try {
      return JSON.parse(text.slice(start, end + 1))
    } catch {
      // Not JSON after all (e.g. "{your}" in prose); try the next brace.
    }
  }
  return undefined
}

/** The index of the "}" closing the "{" at `start`, skipping braces inside strings; -1 if it never closes. */
function matchingBrace(text: string, start: number): number {
  let depth = 0
  let inString = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (ch === '\\') i++
      else if (ch === '"') inString = false
    } else if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) return i
  }
  return -1
}

/**
 * Reads the receipt with the vision model. Null when the model answered but found nothing usable (not a receipt,
 * or no items). Throws ScanUnavailable when the model fails or doesn't answer with JSON.
 */
export async function readReceipt(ai: Ai, image: ScanReceiptInput): Promise<ReceiptScanResult | null> {
  let response: unknown
  try {
    const out = await ai.run(RECEIPT_MODEL, {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Read this receipt.' },
            // The model takes images only as data URIs, never as HTTP URLs.
            { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.imageBase64}` } },
          ],
        },
      ],
      max_tokens: RECEIPT_MAX_TOKENS,
      temperature: 0,
    })
    response = (out as { response?: unknown } | null)?.response
  } catch {
    throw new ScanUnavailable('ai_error')
  }
  // The binding may hand back an object it has already parsed from the model's JSON.
  const answer = typeof response === 'string' ? firstJsonObject(response) : response
  if (typeof answer !== 'object' || answer === null) throw new ScanUnavailable('unparseable')
  return normalizeReceiptScan(answer)
}
