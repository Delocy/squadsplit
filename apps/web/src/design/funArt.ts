// Extra original SVG art for "Your mix" (Squad Reacts, Sticker Book and the ticket wheel), ported from the approved
// mockups in docs/design/explorations/art.ts. Same plum ink and pastels as ./art; no emoji, no third-party characters.
const INK = '#5a3d5c'

const svg = (vb: string, body: string, cls = '') =>
  `<svg class="${cls}" viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" stroke="${INK}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`

/** A pale blue drop of nervous sweat, with a white shine. */
export const sweatDrop = () =>
  svg('0 0 12 16', `<path d="M6 1.5C6 1.5 1.5 7.5 1.5 10.5a4.5 4.5 0 0 0 9 0C10.5 7.5 6 1.5 6 1.5z" fill="#a8d8ff" stroke-width="1.6"/><path d="M4.2 10.5a2 2 0 0 0 1.4 2" fill="none" stroke="#fff" stroke-width="1.3"/>`)

/** A small yellow four-point sparkle, for someone who is owed. */
export const sparkle = () =>
  svg('0 0 24 24', `<path d="M12 2.5l2.4 7.1 7.1 2.4-7.1 2.4L12 21.5l-2.4-7.1L2.5 12l7.1-2.4z" fill="#fff1a8" stroke-width="1.6"/>`)

/** One "Z" of a nap. */
export const zee = () => svg('0 0 14 14', `<path d="M3 3h8L3 11h8" fill="none" stroke-width="2.2"/>`)

/** The pink heart that hops from the payer to the payee. */
export const heart = () =>
  svg('0 0 24 24', `<path d="M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.5A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z" fill="#ff9ec4" stroke-width="1.8"/>`)

/** A long lilac cushion for the squad to nap on. */
export const cushion = () =>
  svg('0 0 300 60', `<path d="M14 30c0-14 18-20 60-20h152c42 0 60 6 60 20s-18 22-60 22H74c-42 0-60-8-60-22z" fill="#e9e2ff" stroke-width="3"/>
    <path d="M40 26q110 10 220 0" fill="none" stroke="#cdb4ff" stroke-width="3"/><circle cx="20" cy="30" r="6" fill="#ffc8dd" stroke-width="2.4"/><circle cx="280" cy="30" r="6" fill="#ffc8dd" stroke-width="2.4"/>`)

/** A round rubber stamp in pink ink, e.g. "PAID". */
export const stamp = (text: string, color = '#e0457f') =>
  svg('0 0 120 120', `<g stroke="${color}" fill="none"><circle cx="60" cy="60" r="52" stroke-width="5" stroke-dasharray="210 6 40 5"/><circle cx="60" cy="60" r="42" stroke-width="2.5"/></g>
    <path d="M28 70l6-4M88 50l6-4" stroke="${color}" stroke-width="2"/>
    <text x="60" y="70" text-anchor="middle" font-family="Fredoka" font-weight="700" font-size="30" letter-spacing="2" fill="${color}" stroke="none">${text}</text>`)

/** A strip of striped washi tape with torn ends. */
export const washi = (c1: string, c2 = '#fff') =>
  svg('0 0 80 22', `<defs><pattern id="w${c1.slice(1)}" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="${c1}"/><rect width="4" height="8" fill="${c2}" opacity=".7"/></pattern></defs>
    <path d="M2 3l3 2-2 2 2 2-2 2 2 2-2 2 2 2-2 2 76 0 -2-2 2-2-2-2 2-2-2-2 2-2-2-2 2-2-2-2z" fill="url(#w${c1.slice(1)})" stroke="none" opacity=".92"/>`)

/** A sticker not collected yet: a dashed outline with a question mark. */
export const lockedSticker = () =>
  svg('0 0 48 48', `<circle cx="24" cy="24" r="19" fill="none" stroke-width="2.4" stroke-dasharray="5 4" opacity=".55"/>
    <text x="24" y="31" text-anchor="middle" font-family="Fredoka" font-weight="700" font-size="20" fill="${INK}" stroke="none" opacity=".45">?</text>`)
