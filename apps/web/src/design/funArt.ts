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
