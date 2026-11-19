import { CATEGORIES, splitEqual, formatMoney, SplitError } from '@shared/money'
import {
  computeBalances, simplifyDebts, maxSettlementAmount, isExpenseLocked,
  type Ledger, type LedgerExpense, type LedgerSettlement,
} from '@shared/ledger'
import { computeBadges, computeLeaderboard, spinWeights, pickWeighted } from '@shared/fun'
import { mascot, categoryIcon, CATEGORY_ART, badgeArt, uiIcon, medal, confettiPiece, type Kind, type Mood } from './icons'

const CUR = 'SGD'
const PEOPLE: Record<string, { name: string; kind: Kind; face: string; bg: string }> = {
  alice: { name: 'Alice', kind: 'bunny', face: '#ffffff', bg: '#ffc8dd' },
  bob: { name: 'Bob', kind: 'bear', face: '#f3d2b3', bg: '#bde0fe' },
  carol: { name: 'Carol', kind: 'panda', face: '#ffffff', bg: '#cdb4ff' },
  dan: { name: 'Dan', kind: 'kitty', face: '#ffe8a3', bg: '#b8f2d8' },
}
const QUIPS = {
  owed: ['The group owes you. Enjoy it while it lasts.', 'Collecting season.', "You're the group's bank right now."],
  owe: ['Time to pay up.', "You're in the red. Settle when you can.", 'Your friends have noticed.'],
  even: ['All settled. Nothing to do here.', 'Zero debt, zero drama.', 'Clean slate.'],
}

let clock = Date.parse('2026-11-19T10:00:00Z')
const now = () => new Date((clock += 60_000)).toISOString()
let seq = 0
const id = () => `x${++seq}`

const ledger: Ledger = { currentMemberIds: Object.keys(PEOPLE), expenses: [], settlements: [], spins: [] }
const descriptions = new Map<string, string>()

function record(desc: string, cents: number, payer: string, cat: string, parts: string[]) {
  const shares = splitEqual(cents, parts, payer)
  const e: LedgerExpense = {
    id: id(), paidBy: payer, amountCents: cents, category: cat, createdAt: now(),
    shares: Object.entries(shares).map(([userId, amountCents]) => ({ userId, amountCents })),
  }
  ledger.expenses.unshift(e)
  descriptions.set(e.id, desc)
}
record('Hotel night 1', 24000, 'alice', '🏨', ['alice', 'bob', 'carol', 'dan'])
record('Drinks at the beach bar', 6400, 'bob', '🍻', ['alice', 'bob', 'carol'])
record('Ride to the airport', 3100, 'alice', '🚕', ['alice', 'carol', 'dan'])

let me = 'alice'
let cat: string = '🍕'
let payer = 'alice'
let tab: 'all' | 'expenses' | 'paybacks' = 'all'
const parts = new Set(Object.keys(PEOPLE))

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T
const nm = (u: string) => PEOPLE[u]?.name ?? u
const money = (c: number) => formatMoney(Math.abs(c), CUR)
const signed = (c: number) => (c > 0 ? '+' : c < 0 ? '−' : '') + money(c)
const tone = (c: number) => (c > 0 ? 'pos' : c < 0 ? 'neg' : 'zero')
const pick = <T,>(xs: T[], seed: number) => xs[seed % xs.length]!
const you = (u: string) => (u === me ? 'You' : nm(u))
const av = (u: string, size = '', mood: Mood = 'calm') => {
  const p = PEOPLE[u]
  return p ? `<span class="av ${size}" style="--c:${p.bg}" title="${p.name}">${mascot(p.kind, p.face, mood)}</span>` : ''
}

function confetti(from: HTMLElement) {
  const r = from.getBoundingClientRect()
  for (let i = 0; i < 14; i++) {
    const s = document.createElement('span')
    s.className = 'confetti'
    s.innerHTML = confettiPiece(i)
    s.style.left = `${r.left + r.width / 2}px`
    s.style.top = `${r.top + r.height / 2}px`
    const ang = Math.random() * Math.PI * 2
    const dist = 60 + Math.random() * 110
    s.style.setProperty('--dx', `${Math.cos(ang) * dist}px`)
    s.style.setProperty('--dy', `${Math.sin(ang) * dist - 40}px`)
    s.style.setProperty('--rot', `${(Math.random() - 0.5) * 360}deg`)
    document.body.appendChild(s)
    setTimeout(() => s.remove(), 1300)
  }
}

// ---------- actions ----------
function addExpense(btn: HTMLElement) {
  const err = $('#err'); err.textContent = ''
  const desc = $<HTMLInputElement>('#desc').value.trim()
  const cents = Math.round(Number($<HTMLInputElement>('#amt').value) * 100)
  if (!desc) return void (err.textContent = 'Add a description.')
  if (!Number.isInteger(cents) || cents < 1) return void (err.textContent = 'The amount needs to be at least $0.01.')
  if (parts.size === 0) return void (err.textContent = 'Pick at least one person to split with.')
  try {
    record(desc, cents, payer, cat, [...parts])
  } catch (e) {
    err.textContent = e instanceof SplitError ? "That's too small to split between that many people." : String(e)
    return
  }
  confetti(btn)
  $<HTMLDialogElement>('#add-dlg').close()
  render()
}

function settle(to: string, amount: number) {
  const s: LedgerSettlement = {
    id: id(), fromUserId: me, toUserId: to, amountCents: amount,
    status: 'pending', createdAt: now(), resolvedAt: null,
  }
  ledger.settlements.unshift(s)
  render()
}

function resolve(sid: string, status: 'confirmed' | 'rejected' | 'cancelled', btn: HTMLElement) {
  const s = ledger.settlements.find(x => x.id === sid)
  if (!s || s.status !== 'pending') return
  s.status = status
  s.resolvedAt = now()
  if (status === 'confirmed') confetti(btn)
  render()
}

let rotation = 0
function spin(btn: HTMLButtonElement) {
  const weights = spinWeights(ledger)
  const r = crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32
  const winner = pickWeighted(weights, r)
  const ids = Object.keys(weights).sort()
  const total = ids.reduce((t, u) => t + weights[u]!, 0)
  let start = 0
  for (const u of ids) { if (u === winner) break; start += weights[u]! }
  const centreDeg = ((start + weights[winner]! / 2) / total) * 360
  rotation += 360 * 5 + (360 - ((rotation + centreDeg) % 360))
  $('#wheel').style.transform = `rotate(${rotation}deg)`
  btn.disabled = true
  const w = $('#winner'); w.innerHTML = '<span class="s">Spinning…</span>'; w.classList.remove('pop')
  setTimeout(() => {
    ledger.spins.unshift({ winnerId: winner, createdAt: now() })
    w.innerHTML = `${av(winner, '', 'nervous')}<span>${nm(winner)} pays next</span>`
    void w.offsetWidth; w.classList.add('pop')
    confetti(w)
    btn.disabled = false
    render(false)
  }, 3050)
}

// ---------- render ----------
function renderStatic() {
  document.querySelectorAll<HTMLElement>('[data-icon]').forEach(el => { el.outerHTML = uiIcon(el.dataset.icon!) })
  $('#logo-mark').innerHTML = mascot('bunny', '#ffffff', 'happy')
  $('#ptr').innerHTML = `<svg viewBox="0 0 24 24"><path d="M4 3h16L12 21z" fill="#f0609a" stroke="#3d2c42" stroke-width="2.4" stroke-linejoin="round"/></svg>`
  renderPickers()
}

function renderPickers() {
  $('#me').innerHTML = Object.keys(PEOPLE)
    .map(u => `<button class="av ${u === me ? 'on' : ''}" style="--c:${PEOPLE[u]!.bg}" data-me="${u}" title="View as ${nm(u)}">${mascot(PEOPLE[u]!.kind, PEOPLE[u]!.face, 'calm')}</button>`).join('')
  $('#cat').innerHTML = CATEGORIES.map(c => {
    const a = CATEGORY_ART[c]!
    return `<button class="chip ${c === cat ? 'on' : ''}" data-cat="${c}"><span class="ci" style="--tint:${a.tint}">${categoryIcon(c)}</span>${a.label}</button>`
  }).join('')
  $('#payer').innerHTML = Object.keys(PEOPLE)
    .map(u => `<button class="chip ${u === payer ? 'on' : ''}" data-payer="${u}">${av(u, 'sm')} ${nm(u)}</button>`).join('')
  $('#parts').innerHTML = Object.keys(PEOPLE)
    .map(u => `<button class="chip ${parts.has(u) ? 'on' : ''}" data-part="${u}">${av(u, 'sm')} ${nm(u)}</button>`).join('')
  renderPreview()
}

function renderPreview() {
  const cents = Math.round(Number($<HTMLInputElement>('#amt').value) * 100)
  const p = $('#preview')
  if (!parts.size || !Number.isInteger(cents) || cents < 1) return void (p.textContent = '')
  try {
    const s = splitEqual(cents, [...parts], payer)
    p.innerHTML = 'Each share: ' + Object.entries(s).map(([u, c]) => `${nm(u)} <b>${money(c)}</b>`).join(' · ')
  } catch { p.textContent = 'Too small to split that many ways.' }
}

function renderWheel(weights: Record<string, number>) {
  const ids = Object.keys(weights).sort()
  const total = ids.reduce((t, u) => t + weights[u]!, 0)
  let a = -Math.PI / 2
  const slices = ids.map(u => {
    const p = PEOPLE[u]!
    const sweep = (weights[u]! / total) * Math.PI * 2
    const [x1, y1] = [100 * Math.cos(a), 100 * Math.sin(a)]
    const mid = a + sweep / 2
    a += sweep
    const [x2, y2] = [100 * Math.cos(a), 100 * Math.sin(a)]
    const [fx, fy] = [62 * Math.cos(mid), 62 * Math.sin(mid)]
    const size = Math.min(42, 20 + sweep * 14)
    return `<path d="M0 0 L${x1} ${y1} A100 100 0 ${sweep > Math.PI ? 1 : 0} 1 ${x2} ${y2} Z" fill="${p.bg}" stroke="#3d2c42" stroke-width="3" stroke-linejoin="round"/>
      <g transform="translate(${fx - size / 2} ${fy - size / 2})"><svg width="${size}" height="${size}" viewBox="0 0 64 64">${mascot(p.kind, p.face, 'calm').replace(/^<svg[^>]*>|<\/svg>$/g, '')}</svg></g>`
  })
  $('#wheel').innerHTML = `<circle r="104" fill="#3d2c42"/>${slices.join('')}<circle r="13" fill="#fff" stroke="#3d2c42" stroke-width="3"/>`
  $('#odds').innerHTML = ids
    .map(u => `<div>${av(u, 'sm')} ${nm(u)} <b>${Math.round((weights[u]! / total) * 100)}%</b></div>`).join('')
}

function render(redrawWheel = true) {
  const bal = computeBalances(ledger)
  const mine = bal[me] ?? 0
  const kind = mine > 0 ? 'owed' : mine < 0 ? 'owe' : 'even'
  const mood: Mood = kind === 'owed' ? 'happy' : kind === 'owe' ? 'nervous' : 'calm'
  const p = PEOPLE[me]!
  $('#balance').className = `card balance ${kind}`
  $('#balance').innerHTML = `
    <div class="buddy">${mascot(p.kind, p.face, mood)}</div>
    <div><div class="lbl">${kind === 'owed' ? "You're owed" : kind === 'owe' ? 'You owe' : 'Your balance'}</div>
    <div class="amt">${kind === 'even' ? 'All square' : money(mine)}</div>
    <div class="quip">${pick(QUIPS[kind], ledger.expenses.length + ledger.settlements.length)}</div></div>`

  const totalSpent = ledger.expenses.reduce((t, e) => t + e.amountCents, 0)
  const myShare = ledger.expenses.reduce((t, e) => t + (e.shares.find(s => s.userId === me)?.amountCents ?? 0), 0)
  const myPaid = ledger.expenses.filter(e => e.paidBy === me).reduce((t, e) => t + e.amountCents, 0)
  $('#group-meta').textContent = `· ${Object.keys(PEOPLE).length} members`
  $('#stats').innerHTML = `
    <div class="stat"><div class="k">Group spend</div><div class="v">${money(totalSpent)}</div></div>
    <div class="stat"><div class="k">Your share</div><div class="v">${money(myShare)}</div></div>
    <div class="stat"><div class="k">You paid</div><div class="v">${money(myPaid)}</div></div>`

  // settle up
  const pend = ledger.settlements.filter(s => s.status === 'pending' && (s.toUserId === me || s.fromUserId === me))
  const needMe = pend.filter(s => s.toUserId === me).length
  const count = $('#need-count'); count.hidden = needMe === 0; count.textContent = String(needMe)
  $('#actions').innerHTML = pend.map(s => s.toUserId === me
    ? `<div class="need row">${av(s.fromUserId, '', 'happy')}<div class="grow"><div class="t">${nm(s.fromUserId)} says they paid you ${money(s.amountCents)}</div>
        <div class="s">Confirm once the money has arrived.</div></div>
        <div class="acts"><button class="btn small primary" data-res="${s.id}:confirmed">Confirm</button><button class="btn small" data-res="${s.id}:rejected">Reject</button></div></div>`
    : `<div class="need row">${av(s.toUserId)}<div class="grow"><div class="t">Waiting for ${nm(s.toUserId)} to confirm</div>
        <div class="s">You marked ${money(s.amountCents)} as paid.</div></div>
        <button class="btn small" data-res="${s.id}:cancelled">Undo</button></div>`).join('')

  const suggestions = simplifyDebts(bal)
  $('#suggest').innerHTML = suggestions.length
    ? suggestions.map(t => {
        const isMine = t.fromUserId === me
        const amt = Math.min(maxSettlementAmount(ledger, t.fromUserId, t.toUserId), t.amountCents)
        return `<li class="row">${av(t.fromUserId, 'sm')}<span class="arrow">${uiIcon('arrow')}</span>${av(t.toUserId, 'sm')}
          <div class="grow"><div class="t">${you(t.fromUserId)} → ${you(t.toUserId)}</div></div>
          <div class="amt-r">${money(t.amountCents)}</div>
          ${isMine ? `<button class="btn small primary" data-settle="${t.toUserId}" data-amt="${amt}" ${amt < 1 ? 'disabled title="Waiting on a confirmation"' : ''}>Mark paid</button>` : ''}</li>`
      }).join('')
    : `<li class="empty">Everyone is settled up.</li>`

  // activity feed
  type Item = { at: string; html: string; kind: 'expense' | 'payback' }
  const items: Item[] = []
  if (tab !== 'paybacks') for (const e of ledger.expenses) {
    const locked = isExpenseLocked(e, ledger.settlements)
    const art = CATEGORY_ART[e.category]
    const share = e.shares.find(s => s.userId === me)?.amountCents ?? 0
    items.push({ at: e.createdAt, kind: 'expense', html: `<li class="row"><div class="tile" style="--tb:${art?.tint ?? '#fff'}">${categoryIcon(e.category)}</div>
      <div class="grow"><div class="t">${descriptions.get(e.id)}${locked ? `<span class="lock">${uiIcon('lock')}locked</span>` : ''}</div>
      <div class="s">${you(e.paidBy)} paid · ${art?.label ?? 'Other'} · split ${e.shares.length} ways</div></div>
      <div class="amt-r">${money(e.amountCents)}<span class="sub">${share ? `your share ${money(share)}` : 'not involved'}</span></div></li>` })
  }
  if (tab !== 'expenses') for (const s of ledger.settlements.filter(x => x.status !== 'pending')) {
    items.push({ at: s.resolvedAt!, kind: 'payback', html: `<li class="row">${av(s.fromUserId, 'sm')}<span class="arrow">${uiIcon('arrow')}</span>${av(s.toUserId, 'sm')}
      <div class="grow"><div class="t">${you(s.fromUserId)} paid ${you(s.toUserId)}</div><div class="s">Payback</div></div>
      <div class="amt-r">${money(s.amountCents)}</div><span class="status">${s.status}</span></li>` })
  }
  items.sort((a, b) => b.at.localeCompare(a.at))
  $('#feed').innerHTML = items.length ? items.map(i => i.html).join('') : '<li class="empty">Nothing here yet.</li>'
  document.querySelectorAll<HTMLElement>('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab))

  // leaderboard
  const board = computeLeaderboard(ledger)
  const maxAbs = Math.max(1, ...board.map(b => Math.abs(b.netCents)))
  $('#board').innerHTML = board.map(b => {
    const w = (Math.abs(b.netCents) / maxAbs) * 50
    const fill = b.netCents >= 0
      ? `<i style="left:50%;width:${w}%;background:var(--good)"></i>`
      : `<i style="right:50%;width:${w}%;background:var(--bad)"></i>`
    return `<div class="lb-row">${medal(b.rank)}<span class="who">${av(b.userId, 'sm')}<span>${nm(b.userId)}</span></span>
      <span class="bar">${fill}</span><span class="num ${tone(b.netCents)}">${signed(b.netCents)}</span></div>`
  }).join('')

  const badges = computeBadges(ledger)
  $('#badges').innerHTML = badges.length
    ? badges.map(b => `<div class="badge"><div class="art">${badgeArt(b.key)}</div><div style="min-width:0"><div class="t">${b.title}</div><div class="h">${nm(b.userId)}</div></div></div>`).join('')
    : '<div class="empty">No titles handed out yet.</div>'

  if (redrawWheel) renderWheel(spinWeights(ledger))
}

// ---------- events ----------
document.addEventListener('click', ev => {
  const t = (ev.target as HTMLElement).closest<HTMLElement>('button')
  if (!t) return
  const d = t.dataset
  if (d.me) { me = d.me; renderPickers(); render(false) }
  else if (d.cat) { cat = d.cat; renderPickers() }
  else if (d.payer) { payer = d.payer; renderPickers() }
  else if (d.part) { parts.has(d.part) ? parts.delete(d.part) : parts.add(d.part); renderPickers() }
  else if (d.settle) settle(d.settle, Number(d.amt))
  else if (d.res) { const [sid, st] = d.res.split(':'); resolve(sid!, st as 'confirmed', t) }
  else if (d.tab) { tab = d.tab as typeof tab; render(false) }
  else if ('openAdd' in d) { payer = me; $('#err').textContent = ''; renderPickers(); $<HTMLDialogElement>('#add-dlg').showModal() }
  else if ('close' in d) $<HTMLDialogElement>('#add-dlg').close()
  else if (d.jump === 'wheel') $('#wheel-card').scrollIntoView({ behavior: 'smooth', block: 'center' })
  else if (t.id === 'add') addExpense(t)
  else if (t.id === 'spin') spin(t as HTMLButtonElement)
})
$('#amt').addEventListener('input', renderPreview)
renderStatic()
render()
