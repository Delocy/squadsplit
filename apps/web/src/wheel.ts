// The wheel's geometry, from the spin weights. Angles are in degrees, clockwise from the top (where the pointer is).

export interface Slice {
  userId: string
  /** Where the slice starts and how far it reaches, in degrees. */
  start: number
  sweep: number
  /** The chance of being picked, as a whole percentage for display. */
  percent: number
}

/** One slice per person, in user-id order (the order the playground and the API's weights use), sized by weight. */
export function wheelSlices(weights: Record<string, number>): Slice[] {
  const ids = Object.keys(weights).sort()
  const total = ids.reduce((t, id) => t + weights[id]!, 0)
  let start = 0
  return ids.map((userId) => {
    const sweep = (weights[userId]! / total) * 360
    const slice = { userId, start, sweep, percent: Math.round((weights[userId]! / total) * 100) }
    start += sweep
    return slice
  })
}

/**
 * The next rotation for the wheel, from where it stands now: five full turns and then on until the
 * middle of the winner's slice is under the pointer. Only ever increases, so the wheel always spins forwards.
 */
export function landingRotation(current: number, slices: Slice[], winnerId: string): number {
  const slice = slices.find((s) => s.userId === winnerId)
  if (!slice) return current
  const centre = slice.start + slice.sweep / 2
  return current + 360 * 5 + (360 - ((current + centre) % 360))
}
