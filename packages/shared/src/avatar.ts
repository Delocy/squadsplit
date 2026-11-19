import { z } from 'zod'

// A member's look inside a group: one of the eight member animals on one of six pastel backgrounds.
// The logo pup is never an avatar. Among a group's active members every combination is unique.

export const AVATAR_ANIMALS = ['bunny', 'bear', 'panda', 'kitty', 'fox', 'hamster', 'penguin', 'koala'] as const
export type AvatarAnimal = (typeof AVATAR_ANIMALS)[number]

/** Background colours. Pastels behind a plum outline, so they read the same in light and dark mode. */
export const AVATAR_COLORS = {
  pink: '#ffc8dd',
  sky: '#bde0fe',
  lilac: '#cdb4ff',
  mint: '#b8f2d8',
  peach: '#ffd8b5',
  lemon: '#fff1a8',
} as const
export type AvatarColor = keyof typeof AVATAR_COLORS
const COLOR_KEYS = Object.keys(AVATAR_COLORS) as [AvatarColor, ...AvatarColor[]]

export const AvatarChoice = z.object({ animal: z.enum(AVATAR_ANIMALS), color: z.enum(COLOR_KEYS) })
export type AvatarChoice = z.infer<typeof AvatarChoice>

const COMBINATIONS = AVATAR_ANIMALS.length * COLOR_KEYS.length

/** FNV-1a: a small, stable string hash, so a user gets the same default on every device and on the server. */
function hash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** The look a user gets when they haven't picked one. Same id, same look. */
export function defaultAvatar(userId: string): AvatarChoice {
  const h = hash(userId)
  return {
    animal: AVATAR_ANIMALS[h % AVATAR_ANIMALS.length]!,
    color: COLOR_KEYS[Math.floor(h / AVATAR_ANIMALS.length) % COLOR_KEYS.length]!,
  }
}

/** The stored choice if both parts are set (and still in the palette), otherwise the user's default. */
export function effectiveAvatar(userId: string, stored: { animal: string | null; color: string | null }): AvatarChoice {
  const parsed = AvatarChoice.safeParse(stored)
  return parsed.success ? parsed.data : defaultAvatar(userId)
}

export const sameAvatar = (a: AvatarChoice, b: AvatarChoice) => a.animal === b.animal && a.color === b.color

const indexOf = (a: AvatarChoice) => AVATAR_ANIMALS.indexOf(a.animal) * COLOR_KEYS.length + COLOR_KEYS.indexOf(a.color)
const atIndex = (i: number): AvatarChoice => ({
  animal: AVATAR_ANIMALS[Math.floor(i / COLOR_KEYS.length)]!,
  color: COLOR_KEYS[i % COLOR_KEYS.length]!,
})

/**
 * `preferred` if nobody in `taken` has it; otherwise the next free combination, walking through the
 * other colours of the same animal first and then on through the animals, wrapping round. If all 48
 * are taken (a group is capped well below that) it returns `preferred`.
 */
export function firstFreeAvatar(preferred: AvatarChoice, taken: AvatarChoice[]): AvatarChoice {
  const start = indexOf(preferred)
  for (let step = 0; step < COMBINATIONS; step++) {
    const candidate = atIndex((start + step) % COMBINATIONS)
    if (!taken.some((t) => sameAvatar(t, candidate))) return candidate
  }
  return preferred
}
