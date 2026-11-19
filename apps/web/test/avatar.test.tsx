import { describe, expect, it } from 'vitest'
import { avatarFor } from '../src/design/Avatar'

describe('avatarFor', () => {
  it('gives the same user the same animal and colour every time', () => {
    expect(avatarFor('user_2abc')).toEqual(avatarFor('user_2abc'))
  })

  it('uses every animal and every background across many users', () => {
    const looks = Array.from({ length: 200 }, (_, i) => avatarFor(`user_${i}`))
    expect(new Set(looks.map((l) => l.kind))).toEqual(new Set(['bunny', 'bear', 'panda', 'kitty']))
    expect(new Set(looks.map((l) => l.bg)).size).toBe(4)
  })
})
