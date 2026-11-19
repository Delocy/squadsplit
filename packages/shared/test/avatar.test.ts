import { describe, expect, it } from 'vitest'
import {
  AVATAR_ANIMALS,
  AVATAR_COLORS,
  AvatarChoice,
  defaultAvatar,
  effectiveAvatar,
  firstFreeAvatar,
  sameAvatar,
  type AvatarColor,
} from '../src/avatar'

const COLORS = Object.keys(AVATAR_COLORS) as AvatarColor[]
const ALL: AvatarChoice[] = AVATAR_ANIMALS.flatMap((animal) => COLORS.map((color) => ({ animal, color })))

describe('the avatar palette', () => {
  it('is the eight member animals, in the order the web draws them', () => {
    expect(AVATAR_ANIMALS).toEqual(['bunny', 'bear', 'panda', 'kitty', 'fox', 'hamster', 'penguin', 'koala'])
  })

  it('has six distinct pastel colours as hex', () => {
    expect(COLORS).toHaveLength(6)
    for (const hex of Object.values(AVATAR_COLORS)) expect(hex).toMatch(/^#[0-9a-f]{6}$/)
    expect(new Set(Object.values(AVATAR_COLORS)).size).toBe(6)
  })
})

describe('AvatarChoice', () => {
  it('accepts a palette animal and colour', () => {
    expect(AvatarChoice.parse({ animal: 'fox', color: 'peach' })).toEqual({ animal: 'fox', color: 'peach' })
  })

  it('rejects the logo pup, unknown colours and missing fields', () => {
    expect(AvatarChoice.safeParse({ animal: 'dog', color: 'peach' }).success).toBe(false)
    expect(AvatarChoice.safeParse({ animal: 'fox', color: 'red' }).success).toBe(false)
    expect(AvatarChoice.safeParse({ animal: 'fox' }).success).toBe(false)
  })
})

describe('defaultAvatar', () => {
  it('gives the same user the same avatar every time', () => {
    for (const id of ['user_2abc', 'user_zz9', '']) expect(defaultAvatar(id)).toEqual(defaultAvatar(id))
  })

  it('keeps the animal the web used to derive from the id (FNV-1a mod 8)', () => {
    // FNV-1a of "" is the offset basis 0x811c9dc5 = 2166136261; 2166136261 % 8 = 5 (hamster).
    expect(defaultAvatar('').animal).toBe('hamster')
  })

  it('spreads users over every animal and every colour', () => {
    const looks = Array.from({ length: 400 }, (_, i) => defaultAvatar(`user_${i}`))
    expect(new Set(looks.map((l) => l.animal))).toEqual(new Set(AVATAR_ANIMALS))
    expect(new Set(looks.map((l) => l.color))).toEqual(new Set(COLORS))
    for (const look of looks) expect(AvatarChoice.safeParse(look).success).toBe(true)
  })
})

describe('effectiveAvatar', () => {
  it('is the stored choice when both parts are set', () => {
    expect(effectiveAvatar('u1', { animal: 'koala', color: 'mint' })).toEqual({ animal: 'koala', color: 'mint' })
  })

  it('falls back to the default when either part is missing or no longer in the palette', () => {
    const fallback = defaultAvatar('u1')
    expect(effectiveAvatar('u1', { animal: null, color: null })).toEqual(fallback)
    expect(effectiveAvatar('u1', { animal: 'koala', color: null })).toEqual(fallback)
    expect(effectiveAvatar('u1', { animal: 'dog', color: 'mint' })).toEqual(fallback)
  })
})

describe('firstFreeAvatar', () => {
  const fox = { animal: 'fox', color: 'peach' } as const

  it('keeps the preferred avatar when nobody has it', () => {
    expect(firstFreeAvatar(fox, [{ animal: 'fox', color: 'mint' }])).toEqual(fox)
  })

  it('walks on to the next free combination, deterministically', () => {
    const taken = [fox]
    const pick = firstFreeAvatar(fox, taken)
    expect(sameAvatar(pick, fox)).toBe(false)
    expect(firstFreeAvatar(fox, taken)).toEqual(pick)
  })

  it('finds the single free combination wherever the walk starts', () => {
    const free = { animal: 'bunny', color: 'pink' } as const
    const taken = ALL.filter((a) => !sameAvatar(a, free))
    for (const start of ALL) expect(firstFreeAvatar(start, taken)).toEqual(free)
  })

  it('visits all 48 combinations: twelve people never run out', () => {
    const taken: AvatarChoice[] = []
    for (let i = 0; i < 48; i++) taken.push(firstFreeAvatar(fox, taken))
    expect(new Set(taken.map((a) => `${a.animal}/${a.color}`)).size).toBe(48)
  })

  it('falls back to the preferred avatar when every combination is taken', () => {
    expect(firstFreeAvatar(fox, ALL)).toEqual(fox)
  })
})
