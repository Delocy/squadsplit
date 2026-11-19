// Ported verbatim from docs/design/playground/icons.ts, the approved art, as SVG strings. Keep the two in step.
// Original kawaii SVG art for SquadSplit. No third-party characters.
const INK = '#5a3d5c'
const BLUSH = '#ff9ec4'

export type Kind = 'bunny' | 'bear' | 'panda' | 'kitty'
export type Mood = 'happy' | 'calm' | 'nervous'

const svg = (vb: string, body: string, cls = '') =>
  `<svg class="${cls}" viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" stroke="${INK}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`

function face(cy: number, mood: Mood, darkPatches = false): string {
  const eyeFill = darkPatches ? '#fff' : INK
  let eyes = ''
  if (mood === 'happy') {
    eyes = `<path d="M21 ${cy - 1} q3 -4.5 6 0 M37 ${cy - 1} q3 -4.5 6 0" fill="none" stroke="${darkPatches ? '#fff' : INK}" stroke-width="2.6"/>`
  } else {
    eyes = `<circle cx="24" cy="${cy - 2}" r="2.7" fill="${eyeFill}" stroke="none"/><circle cx="40" cy="${cy - 2}" r="2.7" fill="${eyeFill}" stroke="none"/>
      <circle cx="25" cy="${cy - 3}" r=".9" fill="${darkPatches ? INK : '#fff'}" stroke="none"/><circle cx="41" cy="${cy - 3}" r=".9" fill="${darkPatches ? INK : '#fff'}" stroke="none"/>`
  }
  const blush = `<ellipse cx="18.5" cy="${cy + 5}" rx="4" ry="2.4" fill="${BLUSH}" stroke="none" opacity=".75"/><ellipse cx="45.5" cy="${cy + 5}" rx="4" ry="2.4" fill="${BLUSH}" stroke="none" opacity=".75"/>`
  const mouth =
    mood === 'happy' ? `<path d="M28 ${cy + 3.5} q4 6.5 8 0 z" fill="#ff7aa8" stroke-width="2"/>`
    : mood === 'nervous' ? `<path d="M27 ${cy + 7} q2.5 -2.2 5 0 q2.5 2.2 5 0" fill="none" stroke-width="2.2"/>`
    : `<path d="M29 ${cy + 4.5} q1.5 2 3 0 q1.5 2 3 0" fill="none" stroke-width="2.2"/>`
  const sweat = mood === 'nervous'
    ? `<path d="M50 ${cy - 16} q4.5 6.5 0 9 q-4.5 -2.5 0 -9z" fill="#a8d8ff" stroke-width="1.6"/>` : ''
  return eyes + blush + mouth + sweat
}

export function mascot(kind: Kind, faceColor: string, mood: Mood = 'calm', cls = ''): string {
  const s = 'stroke-width="3"'
  let body = ''
  if (kind === 'bunny') {
    body = `<ellipse cx="22" cy="15" rx="6.5" ry="13" fill="${faceColor}" ${s}/><ellipse cx="42" cy="15" rx="6.5" ry="13" fill="${faceColor}" ${s}/>
      <ellipse cx="22" cy="16" rx="2.6" ry="8" fill="${BLUSH}" stroke="none"/><ellipse cx="42" cy="16" rx="2.6" ry="8" fill="${BLUSH}" stroke="none"/>
      <ellipse cx="32" cy="40" rx="21" ry="18.5" fill="${faceColor}" ${s}/>` + face(40, mood)
  } else if (kind === 'bear') {
    body = `<circle cx="14" cy="21" r="8.5" fill="${faceColor}" ${s}/><circle cx="50" cy="21" r="8.5" fill="${faceColor}" ${s}/>
      <circle cx="14" cy="21" r="4" fill="#e8b48f" stroke="none"/><circle cx="50" cy="21" r="4" fill="#e8b48f" stroke="none"/>
      <ellipse cx="32" cy="37" rx="22" ry="20" fill="${faceColor}" ${s}/>
      <ellipse cx="32" cy="44" rx="8" ry="5.5" fill="#fff4e8" stroke-width="2"/><ellipse cx="32" cy="41.5" rx="2.6" ry="1.8" fill="${INK}" stroke="none"/>` +
      face(37, mood).replace(/<path d="M2[789][^"]*"[^>]*\/>/, '')
  } else if (kind === 'panda') {
    body = `<circle cx="14" cy="19" r="8" fill="${INK}" ${s}/><circle cx="50" cy="19" r="8" fill="${INK}" ${s}/>
      <ellipse cx="32" cy="37" rx="22" ry="20" fill="${faceColor}" ${s}/>
      <ellipse cx="23.5" cy="35" rx="5.5" ry="7" fill="${INK}" stroke="none" transform="rotate(25 23.5 35)"/>
      <ellipse cx="40.5" cy="35" rx="5.5" ry="7" fill="${INK}" stroke="none" transform="rotate(-25 40.5 35)"/>
      <ellipse cx="32" cy="42" rx="2.4" ry="1.7" fill="${INK}" stroke="none"/>` + face(37, mood, true)
  } else {
    body = `<path d="M11 30 L13 7 L28 19 Z" fill="${faceColor}" ${s}/><path d="M53 30 L51 7 L36 19 Z" fill="${faceColor}" ${s}/>
      <path d="M15 24 L16 13 L23 19 Z" fill="${BLUSH}" stroke="none"/><path d="M49 24 L48 13 L41 19 Z" fill="${BLUSH}" stroke="none"/>
      <ellipse cx="32" cy="38" rx="22" ry="19" fill="${faceColor}" ${s}/>
      <path d="M8 38 h7 M8 44 l7 -2 M56 38 h-7 M56 44 l-7 -2" stroke-width="2"/>
      <path d="M30.5 41 l1.5 1.5 l1.5 -1.5 z" fill="${INK}" stroke-width="1.2"/>` + face(38, mood)
  }
  return svg('0 0 64 64', body, cls)
}

// ---------- category icons (keyed by the stored category value) ----------
const ICON: Record<string, string> = {
  food: `<path d="M3 12h18a9 8 0 0 1-18 0z" fill="#ffd6a5"/><path d="M5.5 12a6.5 4.5 0 0 1 13 0" fill="#fff"/><path d="M14 2.5l6 7.5M17 1.5l5 6.5" fill="none"/>`,
  drinks: `<path d="M16 11h2a3 3 0 0 1 0 6h-2" fill="none"/><rect x="4" y="8" width="12" height="13" rx="2.5" fill="#ffe8a3"/><path d="M3.5 9.5a3 3 0 0 1 3.5-4.5 3 3 0 0 1 5-1 3 3 0 0 1 4.5 2.5 2.4 2.4 0 0 1 0 3z" fill="#fff"/><path d="M8 13v5M12 13v5" fill="none"/>`,
  ride: `<path d="M3 16v-3.5l2.2-5.5h13.6l2.2 5.5V16z" fill="#fff1a8"/><path d="M7 8.5h10l1.3 4H5.7z" fill="#a8d8ff"/><circle cx="7.5" cy="17" r="2.3" fill="#5a3d5c"/><circle cx="16.5" cy="17" r="2.3" fill="#5a3d5c"/>`,
  stay: `<path d="M2.5 20V6.5" fill="none"/><rect x="2.5" y="12" width="19" height="5.5" rx="1.6" fill="#cdb4ff"/><rect x="4.5" y="8.8" width="6" height="3.4" rx="1.5" fill="#fff"/><path d="M21.5 17.5V20" fill="none"/>`,
  shop: `<path d="M5 8.5h14l-1.2 12.5H6.2z" fill="#b8f2d8"/><path d="M9 8.5a3 3 0 0 1 6 0" fill="none"/><path d="M12 13.5c1.5-1.5 3-1 3 0s-1.5 2-3 3c-1.5-1-3-2-3-3s1.5-1.5 3 0z" fill="#ff9ec4" stroke-width="1.2"/>`,
  fun: `<path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z" fill="#ffc8dd"/><path d="M15 7.5v9" stroke-dasharray="1.6 1.8" fill="none"/><path d="M9 9.3l.9 1.9 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.3z" fill="#fff1a8" stroke-width="1.1"/>`,
  flight: `<path d="M2.5 12.5l19-7.5-6 15-3-6.2z" fill="#a8d8ff"/><path d="M12.5 13.8L21.5 5" fill="none"/>`,
  bills: `<path d="M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z" fill="#fff1a8"/><path d="M9.5 19h5M10.5 21.5h3" fill="none"/>`,
  gift: `<rect x="4" y="11" width="16" height="10" rx="1.5" fill="#ffc8dd"/><rect x="3" y="7.5" width="18" height="4" rx="1.2" fill="#ff9ec4"/><path d="M12 7.5V21" fill="none"/><path d="M12 7.5c-2.5-4-6.5-2.5-4 0zM12 7.5c2.5-4 6.5-2.5 4 0z" fill="#fff"/>`,
  other: `<circle cx="12" cy="12" r="8.5" fill="#ffe08a"/><circle cx="12" cy="12" r="5.6" fill="none" stroke-width="1.3"/><path d="M13.6 9.6c-.6-.7-3.2-.9-3.2.7 0 1.7 3.4.9 3.4 2.6 0 1.6-2.7 1.4-3.5.6M12 8v1M12 15v1" fill="none" stroke-width="1.4"/>`,
}
// Stored category values are the spec's emoji set; the UI never shows them, it maps to art.
export const CATEGORY_ART: Record<string, { key: string; label: string; tint: string }> = {
  '🍕': { key: 'food', label: 'Food', tint: '#fff0e0' },
  '🍻': { key: 'drinks', label: 'Drinks', tint: '#fff8d6' },
  '🚕': { key: 'ride', label: 'Rides', tint: '#fffbe0' },
  '🏨': { key: 'stay', label: 'Stay', tint: '#f1ebff' },
  '🛒': { key: 'shop', label: 'Shopping', tint: '#e8fbf2' },
  '🎟️': { key: 'fun', label: 'Fun', tint: '#ffeef5' },
  '✈️': { key: 'flight', label: 'Flights', tint: '#e8f4ff' },
  '💡': { key: 'bills', label: 'Bills', tint: '#fffbe0' },
  '🎁': { key: 'gift', label: 'Gifts', tint: '#ffeef5' },
  '💸': { key: 'other', label: 'Other', tint: '#fff8e0' },
}
export const categoryIcon = (cat: string, cls = '') =>
  svg('0 0 24 24', ICON[CATEGORY_ART[cat]?.key ?? 'other'] ?? '', cls).replace('<svg', '<svg stroke-width="1.7"')

// ---------- badge art ----------
const BADGE: Record<string, string> = {
  debt_goblin: `<path d="M13 17l-4-11 11 6z M35 17l4-11-11 6z" fill="#ff9ec4" stroke-width="2.2"/><circle cx="24" cy="27" r="15" fill="#c3f0ca" stroke-width="2.6"/>
    <path d="M17 24l4 1.5M31 24l-4 1.5" fill="none" stroke-width="2.2"/><circle cx="19.5" cy="28" r="1.9" fill="#5a3d5c" stroke="none"/><circle cx="28.5" cy="28" r="1.9" fill="#5a3d5c" stroke="none"/>
    <path d="M18.5 33.5q5.5 4 11 -1" fill="none" stroke-width="2.2"/><path d="M26 34.5l1 2 1-2.6" fill="#fff" stroke-width="1.2"/>`,
  biggest_spender: `<path d="M17 13h14l-3-6h-8z" fill="#ffd6a5" stroke-width="2.4"/><path d="M24 13c-12 0-15 12-15 18a8 8 0 0 0 8 8h14a8 8 0 0 0 8-8c0-6-3-18-15-18z" fill="#fff1a8" stroke-width="2.6"/>
    <path d="M27.5 22c-1-1.2-6.5-1.6-6.5 1.4 0 3.2 7 1.7 7 5 0 3-5.6 2.6-7.2 1.1M24.2 19v2M24.2 31v2" fill="none" stroke-width="2.2"/>`,
  ghost: `<path d="M10 40V22a14 14 0 0 1 28 0v18l-4.6-3-4.7 3-4.7-3-4.7 3-4.6-3z" fill="#fff" stroke-width="2.6"/>
    <circle cx="19" cy="23" r="2.2" fill="#5a3d5c" stroke="none"/><circle cx="29" cy="23" r="2.2" fill="#5a3d5c" stroke="none"/>
    <ellipse cx="16" cy="28" rx="2.8" ry="1.7" fill="#ff9ec4" stroke="none"/><ellipse cx="32" cy="28" rx="2.8" ry="1.7" fill="#ff9ec4" stroke="none"/><ellipse cx="24" cy="29" rx="2" ry="2.6" fill="#ff7aa8" stroke-width="1.6"/>`,
  bar_tab: `<g transform="scale(2)">${ICON.drinks}</g>`,
  good_egg: `<ellipse cx="24" cy="26" rx="13" ry="16" fill="#fff8e1" stroke-width="2.6"/><path d="M18 25q2 -3 4 0M26 25q2 -3 4 0" fill="none" stroke-width="2.2"/>
    <ellipse cx="16.5" cy="30" rx="2.6" ry="1.6" fill="#ff9ec4" stroke="none"/><ellipse cx="31.5" cy="30" rx="2.6" ry="1.6" fill="#ff9ec4" stroke="none"/><path d="M21 31q3 3.5 6 0" fill="none" stroke-width="2.2"/>`,
  wheel_victim: `<path d="M24 5l5.6 11.6 12.4 1.6-9.1 8.7 2.3 12.4L24 33.3l-11.2 6 2.3-12.4-9.1-8.7 12.4-1.6z" fill="#ffd6e7" stroke-width="2.6"/>
    <path d="M18.5 23.5a2.2 2.2 0 1 1 1.6 2.4M27.5 23.5a2.2 2.2 0 1 1 1.6 2.4" fill="none" stroke-width="1.8"/><circle cx="24" cy="30" r="2" fill="#ff7aa8" stroke-width="1.6"/>`,
}
export const badgeArt = (key: string, cls = '') =>
  svg('0 0 48 48', BADGE[key] ?? '', cls).replace('<svg', '<svg stroke-width="2"')

// ---------- small UI icons ----------
const UI: Record<string, string> = {
  sparkle: `<path d="M12 2.5l2.4 7.1 7.1 2.4-7.1 2.4L12 21.5l-2.4-7.1L2.5 12l7.1-2.4z" fill="#ffc8dd"/>`,
  trophy: `<path d="M7 4h10v5a5 5 0 0 1-10 0z" fill="#ffe08a"/><path d="M7 6H4.5a2.5 2.5 0 0 0 3 4M17 6h2.5a2.5 2.5 0 0 1-3 4M12 14v4M8 20.5h8" fill="none"/>`,
  heart: `<path d="M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.5A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z" fill="#ff9ec4"/>`,
  wheel: `<circle cx="12" cy="12" r="9" fill="#fff"/><path d="M12 3v18M3 12h18" fill="none"/><path d="M12 3a9 9 0 0 1 9 9h-9z" fill="#a8d8ff"/><path d="M12 21a9 9 0 0 1-9-9h9z" fill="#ffc8dd"/><circle cx="12" cy="12" r="2" fill="#fff1a8"/>`,
  receipt: `<path d="M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5z" fill="#fff"/><path d="M9 8h6M9 11.5h6M9 15h4" fill="none"/>`,
  clock: `<circle cx="12" cy="12" r="9" fill="#cdb4ff"/><path d="M12 7v5l3 2" fill="none"/>`,
  arrow: `<path d="M4 12h15M14 7l5 5-5 5" fill="none"/>`,
  plus: `<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.6"/>`,
  lock: `<rect x="5" y="10.5" width="14" height="10" rx="2.5" fill="#fff1a8"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none"/>`,
  star: `<path d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z" fill="#fff1a8"/>`,
}
export const uiIcon = (name: string, cls = '') =>
  svg('0 0 24 24', UI[name] ?? '', cls).replace('<svg', '<svg stroke-width="1.8"')

// Rank medal: pastel coin with the rank number.
export function medal(rank: number): string {
  const fill = rank === 1 ? '#ffe08a' : rank === 2 ? '#e3e6f0' : rank === 3 ? '#ffd0b0' : '#fff'
  return svg('0 0 28 28', `${rank <= 3 ? '<path d="M9 2l3 7M19 2l-3 7" stroke-width="3" stroke="#ff9ec4"/>' : ''}<circle cx="14" cy="17" r="9" fill="${fill}" stroke-width="2.2"/>
    <text x="14" y="17.5" text-anchor="middle" dominant-baseline="middle" font-family="Fredoka" font-weight="700" font-size="11" fill="${INK}" stroke="none">${rank}</text>`, 'medal')
}

// Confetti pieces: hearts and stars in pastel colours.
const PASTELS = ['#ffc8dd', '#a8d8ff', '#cdb4ff', '#b8f2d8', '#fff1a8', '#ff9ec4']
export function confettiPiece(i: number): string {
  const c = PASTELS[i % PASTELS.length]!
  const shape = i % 3 === 0 ? UI.heart!.replace('#ff9ec4', c) : i % 3 === 1 ? UI.star!.replace('#fff1a8', c) : UI.sparkle!.replace('#ffc8dd', c)
  return svg('0 0 24 24', shape).replace('<svg', '<svg stroke-width="1.6" width="22" height="22"')
}
