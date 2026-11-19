import type { Mood } from './icons'

/** How many drops of sweat an avatar shows. */
export type SweatDrops = 0 | 1 | 2 | 3

/**
 * The debt, in the group currency's minor units (cents), from which an avatar shows one, two and three drops of
 * sweat: 20.00, 50.00 and 150.00.
 */
export const SWEAT_FROM = [2000, 5000, 15000] as const

/** How someone feels about their net balance in a group: happy when owed, calm when square, nervous when owing. */
export const moodOf = (netCents: number): Mood => (netCents > 0 ? 'happy' : netCents < 0 ? 'nervous' : 'calm')

export function sweatOf(netCents: number): SweatDrops {
  const debt = -netCents
  return debt >= SWEAT_FROM[2] ? 3 : debt >= SWEAT_FROM[1] ? 2 : debt >= SWEAT_FROM[0] ? 1 : 0
}

/** Everything an avatar shows about its owner's balance. Spread it onto an <Avatar>. */
export interface BalanceMood {
  mood: Mood
  sweat: SweatDrops
  /** Owed money: a little sparkle. */
  sparkle: boolean
}

export const balanceMood = (netCents: number): BalanceMood => ({
  mood: moodOf(netCents),
  sweat: sweatOf(netCents),
  sparkle: netCents > 0,
})
