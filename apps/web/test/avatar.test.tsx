import { describe, expect, it } from 'vitest'
import { avatarFor, SQUAD } from '../src/design/Avatar'

const EIGHT = ['bunny', 'bear', 'panda', 'kitty', 'fox', 'hamster', 'penguin', 'koala']

describe('avatarFor', () => {
  it('gives the same user the same animal and colour every time', () => {
    for (const id of ['user_2abc', 'user_zz9', '']) expect(avatarFor(id)).toEqual(avatarFor(id))
  })

  it('uses all eight animals and all eight backgrounds across many users, and never the logo pup', () => {
    const looks = Array.from({ length: 400 }, (_, i) => avatarFor(`user_${i}`))
    expect(new Set(looks.map((l) => l.kind))).toEqual(new Set(EIGHT))
    expect(new Set(looks.map((l) => l.bg)).size).toBe(8)
  })
})

describe('SQUAD', () => {
  it('is the eight avatar animals, each on its own background', () => {
    expect(SQUAD.map((l) => l.kind)).toEqual(EIGHT)
    expect(new Set(SQUAD.map((l) => l.bg)).size).toBe(8)
  })
})
