// The balance card's line of personality: how your animal feels about your balance, next to someone in the squad.
// "Sweating" is only said where the avatar shows sweat (sweatOf), so the words never contradict the art.
import { sweatOf } from './design/mood'

const FEELING = {
  owe: ['is sweating', 'is sweating buckets'],
  uneasy: ['is getting nervous', 'is a little nervous'],
  owed: ['is grinning', 'is feeling smug', 'is living the dream'],
  even: ['is relaxed', 'is chilling', 'is having a nap'],
}

/** The one with the biggest balance by `pick` (most owed, or most in debt); ties go to the first in the list. */
function most(squad: { name: string; cents: number }[], pick: (cents: number) => number) {
  let best: { name: string; cents: number } | undefined
  for (const m of squad) if (pick(m.cents) > 0 && (!best || pick(m.cents) > pick(best.cents))) best = m
  return best
}

/**
 * "Your fox is sweating. Alice is not." `animal` is your avatar's animal, `cents` your net balance, `squad` everyone
 * else's name and net balance. `seed` picks among a few wordings, so the line changes as the group's history grows.
 */
export function squadQuip({
  animal,
  cents,
  squad,
  seed,
}: {
  animal: string
  cents: number
  squad: { name: string; cents: number }[]
  seed: number
}): string {
  const kind = cents < 0 ? 'owe' : cents > 0 ? 'owed' : 'even'
  const feelings = FEELING[kind === 'owe' && !sweatOf(cents) ? 'uneasy' : kind]
  const you = `Your ${animal} ${feelings[seed % feelings.length]}.`
  const richest = most(squad, (c) => c)
  const poorest = most(squad, (c) => -c)
  if (kind === 'owe') return `${you} ${richest ? `${richest.name} is not.` : 'Time to pay up.'}`
  const sweats = (m: { cents: number }) => (sweatOf(m.cents) ? 'is sweating' : 'is a little nervous')
  if (kind === 'owed') return `${you} ${poorest ? `${poorest.name} ${sweats(poorest)}.` : 'Enjoy it while it lasts.'}`
  if (poorest) return `${you} ${poorest.name} ${sweats(poorest)}, though.`
  return `${you} ${squad.length ? 'So is the whole squad.' : 'Clean slate.'}`
}
