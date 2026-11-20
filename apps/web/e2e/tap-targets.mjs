// Measures every control's tap on real pages in a real browser: each must be at least 44×44px, counting the
// invisible ::after hit area a small control gets (see "Tap targets" in src/design/tokens.css) and, for a checkbox or
// file input, the label it sits in. Runs the real API on a throwaway local D1 with a fake sign-in, the web app with a
// fake Clerk, seeds made-up people, and checks the main screens at 375px and 320px.
//
//   npm run e2e:tap-targets -w @squadsplit/web          (once before: npx playwright install chromium)
//
// Ports: E2E_WEB_PORT (default 5296) and E2E_API_PORT (default 5297; the inspector takes the next one).
// Exits 1 and lists the offenders if any control is too small.
import react from '@vitejs/plugin-react'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const E2E = dirname(fileURLToPath(import.meta.url))
const WEB_DIR = resolve(E2E, '..')
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5296)
const API_PORT = Number(process.env.E2E_API_PORT ?? 5297)
const WEB = `http://localhost:${WEB_PORT}`
const API = `http://localhost:${API_PORT}`
const MIN = 44
const state = mkdtempSync(join(tmpdir(), 'squadsplit-e2e-'))
const wrangler = [resolve(WEB_DIR, '../api/node_modules/.bin/wrangler'), resolve(WEB_DIR, '../../node_modules/.bin/wrangler')].find(existsSync)
if (!wrangler) throw new Error('wrangler not found: run npm ci first')

const run = (args, opts = {}) => spawn(wrangler, args, { cwd: E2E, stdio: ['ignore', 'ignore', 'pipe'], ...opts })
const exited = (child) => new Promise((ok, fail) => child.on('exit', (code) => (code === 0 ? ok() : fail(new Error(`wrangler exited ${code}`)))))

async function startApi() {
  await exited(run(['d1', 'migrations', 'apply', 'squadsplit-e2e', '--local', '--persist-to', state]))
  const api = run(['dev', '--local', '--port', String(API_PORT), '--inspector-port', String(API_PORT + 1), '--persist-to', state, '--var', `WEB_ORIGIN:${WEB}`], { detached: true })
  for (let i = 0; i < 60; i++) {
    if (await fetch(`${API}/health`).then((r) => r.ok, () => false)) return api
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('the API did not start')
}

const startWeb = () =>
  createServer({
    configFile: false,
    root: WEB_DIR,
    envDir: E2E, // never the developer's .env files
    logLevel: 'error',
    plugins: [react()],
    resolve: { alias: [{ find: /^@clerk\/react$/, replacement: resolve(E2E, 'clerk-mock.tsx') }] },
    server: { port: WEB_PORT, strictPort: true, host: 'localhost' },
    define: { 'import.meta.env.VITE_API_URL': JSON.stringify(API), 'import.meta.env.VITE_CLERK_PUBLISHABLE_KEY': JSON.stringify('pk_test_e2e') },
  }).then((server) => server.listen())

/** Made-up people: Dan owns Lunch Buddies with Mei (an account), Arjun (a guest) and Wei Ling (not joined yet). */
async function seed() {
  const call = async (user, method, path, body, guest) => {
    const headers = { 'Content-Type': 'application/json', Origin: WEB, ...(user && { Authorization: `Bearer fake:${user}` }), ...(guest && { 'X-Guest-Token': guest }) }
    const res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`)
    const text = await res.text()
    return text ? JSON.parse(text) : null
  }
  for (const u of ['user_dan', 'user_mei']) await call(u, 'GET', '/me')
  const g = await call('user_dan', 'POST', '/groups', { name: 'Lunch Buddies', emoji: '🍜', currency: 'SGD', members: ['Mei', 'Wei Ling', 'Arjun'] })
  const named = Object.fromEntries(g.members.filter((m) => m.placeholder).map((m) => [m.displayName, m.userId]))
  await call('user_mei', 'POST', `/invites/${g.inviteCode}/join`, { claim: named.Mei })
  const arjun = await call(null, 'POST', `/invites/${g.inviteCode}/guest`, { claim: named.Arjun })
  const all = ['user_dan', 'user_mei', arjun.member.userId, named['Wei Ling']]
  await call('user_dan', 'POST', `/groups/${g.id}/expenses`, { description: 'Chicken rice', amountCents: 8000, paidBy: 'user_dan', category: '🍕', spentOn: '2026-11-18', split: { type: 'equal', participantIds: all } })
  await call('user_mei', 'POST', `/groups/${g.id}/expenses`, { description: 'Bubble tea', amountCents: 1200, paidBy: 'user_mei', category: '🛒', spentOn: '2026-11-17', split: { type: 'equal', participantIds: all } })
  await call('user_mei', 'POST', `/groups/${g.id}/settlements`, { toUserId: 'user_dan', amountCents: 100 })
  const qs = await call('user_dan', 'POST', '/quick-splits', {
    title: 'Team lunch', place: '', spentOn: '2026-11-19', serviceChargeBps: 1000, gstBps: 900,
    people: [{ name: 'Dan', isPayer: true }, { name: 'Mei', isPayer: false }],
    items: [{ name: 'Laksa', amountCents: 1000, personIndexes: [0, 1] }],
  })
  return { groupId: g.id, code: g.inviteCode, guest: { token: arjun.token, userId: arjun.member.userId }, quick: qs }
}

/** Every visible control whose tap (its box, its ::after hit area, or its label) is under 44px either way. */
const measure = (page) =>
  page.evaluate((min) => {
    const sel = 'a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=tab], summary, label:not(.f)'
    const small = new Set()
    for (let el of document.querySelectorAll(sel)) {
      if (el.tagName === 'INPUT' && ['checkbox', 'radio', 'file'].includes(el.type) && el.closest('label')) el = el.closest('label')
      if (el.tagName === 'LABEL' && !el.querySelector('input[type=checkbox], input[type=radio], input[type=file]')) continue
      const box = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      if (!(box.width > 0 && box.height > 0) || style.visibility === 'hidden' || el.closest('[aria-hidden=true], [inert]')) continue
      const after = getComputedStyle(el, '::after')
      const hit = after.content !== 'none' && after.position === 'absolute' && after.width.endsWith('px')
      const w = Math.max(box.width, hit ? parseFloat(after.width) : 0)
      const h = Math.max(box.height, hit ? parseFloat(after.height) : 0)
      if (w < min - 0.5 || h < min - 0.5) {
        const name = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30)
        small.add(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} "${name}" ${Math.round(w)}x${Math.round(h)}`)
      }
    }
    return [...small]
  }, MIN)

async function check(browser, width, data, receipt) {
  const height = width === 320 ? 640 : 812
  const screens = [
    ['landing', null, '/'],
    ['groups', 'user_dan', '/groups'],
    ['groups menu', 'user_dan', '/groups', (p) => p.getByRole('button', { name: 'Your menu' }).click()],
    ['create group', 'user_dan', '/groups/new'],
    ['group home', 'user_dan', `/groups/${data.groupId}`],
    ['group home (guest)', 'guest', `/groups/${data.groupId}`],
    ['settle form', 'user_mei', `/groups/${data.groupId}`, (p) => p.getByRole('button', { name: 'Mark paid' }).first().click()],
    ['wheel', 'user_dan', `/groups/${data.groupId}/wheel`],
    ['settings (owner)', 'user_dan', `/groups/${data.groupId}/settings`],
    ['settings (member)', 'user_mei', `/groups/${data.groupId}/settings`, (p) => p.getByText('Show QR code').click()],
    ['invite sheet and menu', 'user_dan', `/groups/${data.groupId}/invite`, (p) => p.getByRole('button', { name: 'Invite link options' }).click()],
    ['expense', 'user_dan', `/groups/${data.groupId}/expenses/new`],
    ['expense, scanned', 'user_dan', `/groups/${data.groupId}/expenses/new`, (p) => p.locator('input[type=file]').first().setInputFiles(receipt)],
    ['expense, discard question', 'user_dan', `/groups/${data.groupId}/expenses/new`, async (p) => {
      await p.locator('#exp-desc').fill('x')
      await p.getByRole('button', { name: 'Cancel' }).click()
    }],
    ['join, new guest', null, `/join/${data.code}`, async (p) => {
      await p.getByRole('button', { name: "I'm new" }).click()
      await p.getByText('Change how the group sees you').click()
    }],
    ['join, dead link', 'user_dan', '/join/ZZZZZZZZ'],
    ['quick split, scanned', 'user_dan', '/quick/new', (p) => p.locator('input[type=file]').first().setInputFiles(receipt)],
    ['quick split card', 'user_dan', `/quick/${data.quick.id}`],
    ['quick split share page', null, `/s/${data.quick.share.token}`, (p) => p.getByRole('button', { name: /Mei/ }).first().click()],
    ['profile', 'user_dan', '/me'],
  ]
  let failed = 0
  for (const [label, user, path, act] of screens) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
    await context.addInitScript(({ user, groupId, guest }) => {
      if (sessionStorage.getItem('e2e.init')) return
      sessionStorage.setItem('e2e.init', '1')
      if (user && user !== 'guest') localStorage.setItem('e2e.user', user)
      if (user === 'guest') localStorage.setItem(`squadsplit.guest.${groupId}`, JSON.stringify({ ...guest, groupName: 'Lunch Buddies', code: '' }))
    }, { user, groupId: data.groupId, guest: data.guest })
    const page = await context.newPage()
    await page.goto(WEB + path)
    await page.waitForLoadState('networkidle')
    if (act) {
      await act(page)
      await page.waitForTimeout(400)
      await page.waitForLoadState('networkidle')
    }
    const small = await measure(page)
    failed += small.length
    console.log(`${small.length ? 'FAIL' : 'ok  '} ${width}px ${label}${small.map((s) => `\n       ${s}`).join('')}`)
    await context.close()
  }
  return failed
}

let api
let web
let browser
let failed = 0
try {
  api = await startApi()
  web = await startWeb()
  const data = await seed()
  browser = await chromium.launch()
  // A receipt photo to scan (the scan itself is canned): any JPEG will do.
  const receipt = join(state, 'receipt.jpg')
  const shooter = await browser.newPage()
  await shooter.setContent('<div style="width:300px;height:400px;background:#fff;font:20px sans-serif">RECEIPT</div>')
  await shooter.screenshot({ path: receipt, type: 'jpeg' })
  await shooter.close()
  for (const width of [375, 320]) failed += await check(browser, width, data, receipt)
  console.log(failed ? `\n${failed} controls under ${MIN}px` : `\nEvery control takes a ${MIN}×${MIN}px tap at 375px and 320px.`)
} finally {
  await browser?.close()
  await web?.close()
  if (api) {
    try {
      process.kill(-api.pid, 'SIGTERM')
    } catch {
      api.kill('SIGTERM')
    }
  }
  rmSync(state, { recursive: true, force: true })
}
process.exit(failed ? 1 : 0)
