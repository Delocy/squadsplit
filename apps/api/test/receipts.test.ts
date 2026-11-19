import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiErrorBody, GroupDTO, ReceiptScanDTO } from '@squadsplit/shared'
import { RECEIPT_MODEL, RECEIPT_SCAN_DAILY_CAP, RECEIPT_SCANS_PER_USER_PER_DAY } from '../src/receipts/config'
import { json, testApp } from './helpers'

const base64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes))
const JPEG = base64([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])
const PNG = base64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])
const WEBP = base64([...'RIFF'].map((c) => c.charCodeAt(0)).concat([0x24, 0, 0, 0], [...'WEBPVP8 '].map((c) => c.charCodeAt(0))))

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
    expect(max_tokens).toBeGreaterThanOrEqual(1024)
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

  it('takes PNG and WebP images too', async () => {
    const group = await newGroup()
    expect((await scan(group.id, alice, { imageBase64: PNG, mimeType: 'image/png' })).status).toBe(200)
    expect((await scan(group.id, alice, { imageBase64: WEBP, mimeType: 'image/webp' })).status).toBe(200)
    const urls = ai.run.mock.calls.map(([, input]) => JSON.stringify(input))
    expect(urls[0]).toContain(`data:image/png;base64,${PNG}`)
    expect(urls[1]).toContain(`data:image/webp;base64,${WEBP}`)
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
      [{ imageBase64: 'A'.repeat(7_000_000), mimeType: 'image/jpeg' }, 'validation_failed'],
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
    const others = Array.from({ length: RECEIPT_SCAN_DAILY_CAP / 10 }, (_, i) => `other${i}`)
    for (const id of others.slice(1)) await setScans(id, 10)
    await setScans(others[0]!, 9)
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

  it('answers 503 scan_unavailable when the model fails, does not count the scan, and logs only a reason code', async () => {
    const group = await newGroup()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    ai.run.mockRejectedValueOnce(new Error('4006: you have used up your daily free allocation of 10,000 neurons'))

    const res = await scan(group.id)
    expect(res.status).toBe(503)
    expect(((await res.json()) as ApiErrorBody).error.code).toBe('scan_unavailable')
    expect(await scansOf('alice')).toBe(0)
    expect(warn).toHaveBeenCalledWith('receipt scan failed:', 'ai_error')
    const logged = JSON.stringify([...warn.mock.calls, ...error.mock.calls])
    expect(logged).not.toContain(JPEG)
  })

  it('answers 503 scan_unavailable when the model does not answer with JSON, and does not count it', async () => {
    const group = await newGroup()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const response of ['Sorry, I cannot help with that.', '{"items": [', '', null]) {
      ai = fakeAi(response)
      const res = await scan(group.id)
      expect(res.status).toBe(503)
      expect(((await res.json()) as ApiErrorBody).error.code).toBe('scan_unavailable')
    }
    expect(warn).toHaveBeenCalledWith('receipt scan failed:', 'unparseable')
    expect(await scansOf('alice')).toBe(0)
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
