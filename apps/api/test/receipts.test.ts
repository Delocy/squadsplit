import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiErrorBody, GroupDTO, ReceiptScanDTO } from '@squadsplit/shared'
import {
  RECEIPT_MAX_IMAGE_EDGE,
  RECEIPT_MAX_TOKENS,
  RECEIPT_MODEL,
  RECEIPT_SCAN_DAILY_CAP,
  RECEIPT_SCANS_PER_USER_PER_DAY,
  RECEIPT_WORST_CASE_NEURONS,
  WORKERS_AI_FREE_NEURONS_PER_DAY,
} from '../src/receipts/config'
import { json, testApp } from './helpers'

// Image headers: just enough of each format for the API to read its type and size.
const base64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes))
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))
const be16 = (n: number) => [n >> 8, n & 0xff]
const be32 = (n: number) => [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
const le16 = (n: number) => [n & 0xff, n >> 8]
const le24 = (n: number) => [n & 0xff, (n >> 8) & 0xff, n >> 16]
const le32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24]
/** JFIF APP0, a comment (as an EXIF-style segment before the frame), then the frame header SOF0 or SOF2 (progressive). */
const jpeg = (w: number, h: number, sof = 0xc0) =>
  base64([
    0xff, 0xd8,
    0xff, 0xe0, ...be16(16), ...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0,
    0xff, 0xfe, ...be16(7), ...ascii('hello'),
    0xff, sof, ...be16(17), 8, ...be16(h), ...be16(w), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
    0xff, 0xd9,
  ])
const png = (w: number, h: number) => base64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), ...ascii('IHDR'), ...be32(w), ...be32(h), 8, 2, 0, 0, 0])
const riff = (chunk: number[]) => [...ascii('RIFF'), ...le32(chunk.length + 4), ...ascii('WEBP'), ...chunk]
const webpLossy = (w: number, h: number) => base64(riff([...ascii('VP8 '), ...le32(10), 0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(w), ...le16(h)]))
const webpLossless = (w: number, h: number) => base64(riff([...ascii('VP8L'), ...le32(5), 0x2f, ...le32((w - 1) | ((h - 1) << 14))]))
const webpExtended = (w: number, h: number) => base64(riff([...ascii('VP8X'), ...le32(10), 0, 0, 0, 0, ...le24(w - 1), ...le24(h - 1)]))

const JPEG = jpeg(768, 1024)
const PNG = png(1024, 768)
const WEBP = webpLossy(768, 1024)

const SG_RECEIPT = {
  items: [
    { name: 'Laksa', amountCents: 6000 },
    { name: 'Satay x10', amountCents: 1800 },
  ],
  serviceChargeBps: 1000,
  gstBps: 900,
  totalCents: 9352,
}

/** A fake Workers AI binding whose model answers `response`. */
function fakeAi(response: unknown = JSON.stringify(SG_RECEIPT)) {
  const run = vi.fn(async (_model: string, _input: unknown): Promise<unknown> => ({ response }))
  return { ai: { run } as unknown as Ai, run }
}

let ai = fakeAi()
beforeEach(() => {
  ai = fakeAi()
})
afterEach(() => {
  vi.restoreAllMocks()
})

const app = testApp({
  get AI() {
    return ai.ai
  },
})
const alice = app.as('alice')
const bob = app.as('bob')
const carol = app.as('carol')

async function newGroup() {
  const res = await alice('/groups', json('POST', { name: 'Supper', emoji: '🍜' }))
  const group = (await res.json()) as GroupDTO
  await bob(`/invites/${group.inviteCode}/join`, { method: 'POST' })
  return group
}

const scan = (groupId: string, as = alice, body: unknown = { imageBase64: JPEG, mimeType: 'image/jpeg' }) =>
  as(`/groups/${groupId}/receipts/scan`, json('POST', body))

const today = () => new Date().toISOString().slice(0, 10)
const scansOf = (userId: string, day = today()) =>
  env.DB.prepare('SELECT count FROM receipt_scans WHERE user_id = ? AND day = ?').bind(userId, day).first<number>('count')
const setScans = (userId: string, count: number, day = today()) =>
  env.DB.prepare('INSERT INTO receipt_scans (user_id, day, count) VALUES (?, ?, ?)').bind(userId, day, count).run()

describe('receipt scan budget', () => {
  it('keeps a full day of worst-case scans to three quarters of the free Workers AI allowance', () => {
    expect(RECEIPT_WORST_CASE_NEURONS).toBe(180)
    expect(RECEIPT_SCAN_DAILY_CAP * RECEIPT_WORST_CASE_NEURONS).toBeLessThanOrEqual(0.75 * WORKERS_AI_FREE_NEURONS_PER_DAY)
  })
})

describe('POST /groups/:id/receipts/scan', () => {
  it('reads the receipt with the vision model and returns the items, charges and total check', async () => {
    const group = await newGroup()
    const res = await scan(group.id)

    expect(res.status).toBe(200)
    const body = (await res.json()) as ReceiptScanDTO
    expect(body).toEqual({ ...SG_RECEIPT, totalMatches: true, source: 'ai' })

    expect(ai.run).toHaveBeenCalledTimes(1)
    const [model, input] = ai.run.mock.calls[0]!
    expect(model).toBe(RECEIPT_MODEL)
    expect(model).toBe('@cf/mistralai/mistral-small-3.1-24b-instruct')
    const { messages, max_tokens } = input as { messages: { role: string; content: unknown }[]; max_tokens: number }
    expect(max_tokens).toBe(RECEIPT_MAX_TOKENS)
    expect(RECEIPT_MAX_TOKENS).toBeLessThanOrEqual(1024)
    expect(messages[0]).toMatchObject({ role: 'system', content: expect.stringContaining('amountCents') })
    expect(messages[1]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: expect.any(String) },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${JPEG}` } },
      ],
    })
    expect(await scansOf('alice')).toBe(1)
  })

  it('takes PNG and WebP (lossy, lossless and extended) images too, and progressive JPEGs', async () => {
    const group = await newGroup()
    const ok: [string, string][] = [
      [PNG, 'image/png'],
      [WEBP, 'image/webp'],
      [webpLossless(1600, 1200), 'image/webp'],
      [webpExtended(1200, 1600), 'image/webp'],
      [jpeg(1600, 1600, 0xc2), 'image/jpeg'],
    ]
    for (const [imageBase64, mimeType] of ok) {
      expect((await scan(group.id, alice, { imageBase64, mimeType })).status).toBe(200)
    }
    const urls = ai.run.mock.calls.map(([, input]) => JSON.stringify(input))
    expect(urls[0]).toContain(`data:image/png;base64,${PNG}`)
    expect(urls[1]).toContain(`data:image/webp;base64,${WEBP}`)
  })

  it(`rejects images over ${RECEIPT_MAX_IMAGE_EDGE}px on either side with 422 image_too_large, without calling the model`, async () => {
    const group = await newGroup()
    const big: [string, string][] = [
      [jpeg(RECEIPT_MAX_IMAGE_EDGE + 1, 1000), 'image/jpeg'],
      [jpeg(1000, 4032, 0xc2), 'image/jpeg'],
      [png(1000, RECEIPT_MAX_IMAGE_EDGE + 1), 'image/png'],
      [webpLossy(3000, 1000), 'image/webp'],
      [webpLossless(1000, 2000), 'image/webp'],
      [webpExtended(1601, 1601), 'image/webp'],
    ]
    for (const [imageBase64, mimeType] of big) {
      const res = await scan(group.id, alice, { imageBase64, mimeType })
      expect(res.status).toBe(422)
      expect(((await res.json()) as ApiErrorBody).error.code).toBe('image_too_large')
    }
    expect(ai.run).not.toHaveBeenCalled()
    expect(await scansOf('alice')).toBeNull()
  })

  it('finds the JSON when the model wraps it in a code fence or adds words around it', async () => {
    const group = await newGroup()
    ai = fakeAi('Here is the receipt:\n```json\n' + JSON.stringify(SG_RECEIPT, null, 2) + '\n```\nEnjoy {your} meal!')
    const res = await scan(group.id)
    expect(res.status).toBe(200)
    expect(((await res.json()) as ReceiptScanDTO).items).toEqual(SG_RECEIPT.items)
  })

  it('accepts an answer the binding has already parsed into an object', async () => {
    const group = await newGroup()
    ai = fakeAi(SG_RECEIPT)
    const res = await scan(group.id)
    expect(res.status).toBe(200)
    expect(((await res.json()) as ReceiptScanDTO).totalCents).toBe(9352)
  })

  it('cleans the answer: trims and shortens names, drops unusable items, and reads out-of-range charges as unknown', async () => {
    const group = await newGroup()
    ai = fakeAi(
      JSON.stringify({
        items: [
          { name: '  Kopi  ', amountCents: 180 },
          { name: 'Free refill', amountCents: 0 },
          { name: 'y'.repeat(70), amountCents: 300.4 },
        ],
        serviceChargeBps: 5000,
        gstBps: 900,
        totalCents: null,
      }),
    )
    const body = (await (await scan(group.id)).json()) as ReceiptScanDTO
    expect(body).toEqual({
      items: [
        { name: 'Kopi', amountCents: 180 },
        { name: 'y'.repeat(60), amountCents: 300 },
      ],
      serviceChargeBps: null,
      gstBps: 900,
      totalCents: null,
      totalMatches: null,
      source: 'ai',
    })
  })

  it('says when the items do not add up to the printed total', async () => {
    const group = await newGroup()
    ai = fakeAi(JSON.stringify({ ...SG_RECEIPT, totalCents: 10_000 }))
    const body = (await (await scan(group.id)).json()) as ReceiptScanDTO
    expect(body.totalMatches).toBe(false)
  })

  it('is 404 for someone outside the group, without calling the model or counting a scan', async () => {
    const group = await newGroup()
    const res = await scan(group.id, carol)
    expect(res.status).toBe(404)
    expect(ai.run).not.toHaveBeenCalled()
    expect(await scansOf('carol')).toBeNull()
  })

  it('rejects a body that is not a JPEG, PNG or WebP image with 422, without calling the model', async () => {
    const group = await newGroup()
    const bad: [unknown, string][] = [
      [{ imageBase64: JPEG, mimeType: 'image/gif' }, 'validation_failed'],
      [{ imageBase64: '', mimeType: 'image/jpeg' }, 'validation_failed'],
      [{ imageBase64: 'not base64 at all!', mimeType: 'image/jpeg' }, 'not_an_image'],
      [{ imageBase64: btoa('Laksa 10.00\nTOTAL 10.00'), mimeType: 'image/jpeg' }, 'not_an_image'],
      [{ imageBase64: PNG, mimeType: 'image/jpeg' }, 'not_an_image'],
      // The right first bytes, but no size anywhere: a JPEG cut off before its frame header, a PNG without IHDR.
      [{ imageBase64: base64([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]), mimeType: 'image/jpeg' }, 'not_an_image'],
      [{ imageBase64: base64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, ...ascii('IDAT')]), mimeType: 'image/png' }, 'not_an_image'],
    ]
    for (const [body, code] of bad) {
      const res = await scan(group.id, alice, body)
      expect(res.status).toBe(422)
      expect(((await res.json()) as ApiErrorBody).error.code).toBe(code)
    }
    expect(ai.run).not.toHaveBeenCalled()
    expect(await scansOf('alice')).toBeNull()
  })

  it(`allows ${RECEIPT_SCANS_PER_USER_PER_DAY} scans per user per UTC day, then answers 429 scan_limit`, async () => {
    const group = await newGroup()
    await setScans('alice', RECEIPT_SCANS_PER_USER_PER_DAY - 1)
    expect((await scan(group.id)).status).toBe(200)

    const res = await scan(group.id)
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({
      error: { code: 'scan_limit', message: 'Receipt scanning is resting until tomorrow — enter the items by hand.' },
    })
    expect(ai.run).toHaveBeenCalledTimes(1)
    expect(await scansOf('alice')).toBe(RECEIPT_SCANS_PER_USER_PER_DAY)
    // Someone else still can, and yesterday's scans don't count today.
    expect((await scan(group.id, bob)).status).toBe(200)
    await setScans('bob', RECEIPT_SCANS_PER_USER_PER_DAY, '2000-01-01')
    expect((await scan(group.id, bob)).status).toBe(200)
  })

  it(`stops everyone once the app has made ${RECEIPT_SCAN_DAILY_CAP} scans today`, async () => {
    const group = await newGroup()
    // Other people have made all but one of today's scans between them.
    for (let left = RECEIPT_SCAN_DAILY_CAP - 1, i = 0; left > 0; left -= 10, i++) await setScans(`other${i}`, Math.min(10, left))
    expect((await scan(group.id, bob)).status).toBe(200)

    const res = await scan(group.id, alice)
    expect(res.status).toBe(429)
    expect(((await res.json()) as ApiErrorBody).error.code).toBe('scan_limit')
    expect(await scansOf('alice')).toBeNull()
    expect(ai.run).toHaveBeenCalledTimes(1)
  })

  it('never lets two scans at once go past the daily limit', async () => {
    const group = await newGroup()
    await setScans('alice', RECEIPT_SCANS_PER_USER_PER_DAY - 1)
    const statuses = (await Promise.all([scan(group.id), scan(group.id)])).map((r) => r.status).sort()
    expect(statuses).toEqual([200, 429])
    expect(await scansOf('alice')).toBe(RECEIPT_SCANS_PER_USER_PER_DAY)
  })

  it('answers 503 scan_unavailable when the model fails before answering, gives the scan back, and logs only a reason code', async () => {
    const group = await newGroup()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    ai.run.mockRejectedValueOnce(new Error('3040: Capacity temporarily exceeded, please try again.'))

    const res = await scan(group.id)
    expect(res.status).toBe(503)
    expect(((await res.json()) as ApiErrorBody).error.code).toBe('scan_unavailable')
    expect(await scansOf('alice')).toBe(0)
    expect(warn).toHaveBeenCalledWith('receipt scan failed:', 'ai_error')
    const logged = JSON.stringify([...warn.mock.calls, ...error.mock.calls])
    expect(logged).not.toContain(JPEG)
  })

  it('answers 429 scan_limit when Workers AI has used up the account’s daily allowance, and gives the scan back', async () => {
    const group = await newGroup()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const quotaErrors = [
      new Error('4006: you have used up your daily free allocation of 10,000 neurons, please upgrade to Cloudflare’s Workers Paid plan'),
      Object.assign(new Error('AiError'), { code: 4006 }),
      new Error('Workers AI failed', { cause: new Error('4006: daily free allocation exceeded') }),
    ]
    for (const err of quotaErrors) {
      ai.run.mockRejectedValueOnce(err)
      const res = await scan(group.id)
      expect(res.status).toBe(429)
      expect(await res.json()).toEqual({
        error: { code: 'scan_limit', message: 'Receipt scanning is resting until tomorrow — enter the items by hand.' },
      })
    }
    expect(warn).toHaveBeenCalledWith('receipt scan failed:', 'ai_quota')
    expect(await scansOf('alice')).toBe(0)
  })

  it('answers 422 receipt_unreadable when the model does not answer with JSON, and counts it: the model ran', async () => {
    const group = await newGroup()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const replies = ['Sorry, I cannot help with that.', '{"items": [', '', null]
    for (const response of replies) {
      ai = fakeAi(response)
      const res = await scan(group.id)
      expect(res.status).toBe(422)
      expect(((await res.json()) as ApiErrorBody).error.code).toBe('receipt_unreadable')
    }
    expect(warn).toHaveBeenCalledWith('receipt scan failed:', 'unparseable')
    expect(await scansOf('alice')).toBe(replies.length)
  })

  it('stops a loop of prose answers at the daily limit, so it cannot burn the account’s allowance', async () => {
    const group = await newGroup()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    ai = fakeAi('I see a photo of a cat.')
    const statuses: number[] = []
    for (let i = 0; i <= RECEIPT_SCANS_PER_USER_PER_DAY; i++) statuses.push((await scan(group.id)).status)
    expect(statuses.filter((s) => s === 422)).toHaveLength(RECEIPT_SCANS_PER_USER_PER_DAY)
    expect(statuses.at(-1)).toBe(429)
    expect(ai.run).toHaveBeenCalledTimes(RECEIPT_SCANS_PER_USER_PER_DAY)
  })

  it('forgets scan counts older than 7 days when it counts a new one', async () => {
    const group = await newGroup()
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)
    await setScans('bob', 5, daysAgo(8))
    await setScans('carol', 3, daysAgo(6))
    expect((await scan(group.id)).status).toBe(200)
    const days = await env.DB.prepare('SELECT user_id, day FROM receipt_scans ORDER BY user_id').all()
    expect(days.results).toEqual([
      { user_id: 'alice', day: today() },
      { user_id: 'carol', day: daysAgo(6) },
    ])
  })

  it('refuses a body over 2 MB with 413 payload_too_large before reading it', async () => {
    const group = await newGroup()
    const res = await scan(group.id, alice, { imageBase64: 'A'.repeat(2 * 1024 * 1024), mimeType: 'image/jpeg' })
    expect(res.status).toBe(413)
    expect(((await res.json()) as ApiErrorBody).error.code).toBe('payload_too_large')
    expect(ai.run).not.toHaveBeenCalled()
  })

  it('answers 422 receipt_unreadable when the model finds no items, and counts that scan', async () => {
    const group = await newGroup()
    ai = fakeAi(JSON.stringify({ items: [], serviceChargeBps: null, gstBps: null, totalCents: null }))
    const res = await scan(group.id)
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({
      error: { code: 'receipt_unreadable', message: "Couldn't read this receipt — add the items by hand." },
    })
    expect(await scansOf('alice')).toBe(1)
  })
})

describe('POST /receipts/scan (no group, for a quick split)', () => {
  const scanAlone = (as = alice, body: unknown = { imageBase64: JPEG, mimeType: 'image/jpeg' }) => as('/receipts/scan', json('POST', body))

  it('reads the receipt the same way, for any signed-in user', async () => {
    const res = await scanAlone(carol)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ...SG_RECEIPT, totalMatches: true, source: 'ai' })
    expect(await scansOf('carol')).toBe(1)
  })

  it('shares the daily quota with the group route', async () => {
    const group = await newGroup()
    await setScans('alice', RECEIPT_SCANS_PER_USER_PER_DAY - 2)
    expect((await scan(group.id)).status).toBe(200)
    expect((await scanAlone()).status).toBe(200)
    const over = await scanAlone()
    expect(over.status).toBe(429)
    expect(((await over.json()) as ApiErrorBody).error.code).toBe('scan_limit')
    expect((await scan(group.id)).status).toBe(429)
    expect(await scansOf('alice')).toBe(RECEIPT_SCANS_PER_USER_PER_DAY)
  })

  it('takes a photo bigger than 64 KB, and refuses a body over 2 MB with 413', async () => {
    const bigButFine = await scanAlone(alice, { imageBase64: JPEG + 'A'.repeat(100_000), mimeType: 'image/jpeg' })
    expect(bigButFine.status).not.toBe(413)
    const tooBig = await scanAlone(alice, { imageBase64: 'A'.repeat(2 * 1024 * 1024), mimeType: 'image/jpeg' })
    expect(tooBig.status).toBe(413)
    expect(ai.run).not.toHaveBeenCalled()
  })

  it('answers 422 not_an_image and 401 without a session, like the group route', async () => {
    expect((await scanAlone(alice, { imageBase64: btoa('hello world!'), mimeType: 'image/png' })).status).toBe(422)
    expect((await app.anon('/receipts/scan', json('POST', { imageBase64: JPEG, mimeType: 'image/jpeg' }))).status).toBe(401)
  })
})
