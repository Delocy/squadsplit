// The real SquadSplit API for browser checks, with a fake sign-in ("Bearer fake:<userId>") and a canned receipt
// scan. Test code only: it injects auth through createApp(deps), as the API tests do. Never deployed.
import { createApp } from '../../api/src/app'
import { itemizedTotal, receiptTotalMatches } from '@squadsplit/shared'

const NAMES: Record<string, string> = { user_dan: 'Dan Tan', user_mei: 'Mei Ling', user_jun: 'Jun Wei' }
const deps = {
  async verifyToken(token: string) {
    return token.startsWith('fake:') ? token.slice(5) : null
  },
  async fetchProfile(userId: string) {
    return { displayName: NAMES[userId] ?? 'Someone', avatarUrl: null }
  },
}
// A hawker receipt whose printed total is $1.20 above its items, so the fix-up shows.
const items = [
  { name: 'Hokkien mee', amountCents: 800 },
  { name: 'Chicken rice', amountCents: 650 },
  { name: 'Sambal kangkong', amountCents: 1200 },
]
const charges = { serviceChargeBps: 1000, gstBps: 900 }
const scan = { items, ...charges, totalCents: itemizedTotal({ items: items.map((it) => ({ ...it, userIds: [] })), ...charges }) + 120 }
const RECEIPT = { ...scan, totalMatches: receiptTotalMatches(scan), source: 'ai' }

const app = createApp(deps as never)
export default {
  async fetch(req: Request, env: { WEB_ORIGIN: string }, ctx: ExecutionContext) {
    if (req.method === 'POST' && /^\/(groups\/[^/]+\/)?receipts\/scan$/.test(new URL(req.url).pathname)) {
      return new Response(JSON.stringify(RECEIPT), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': env.WEB_ORIGIN } })
    }
    return app.fetch(req, env as never, ctx)
  },
}
