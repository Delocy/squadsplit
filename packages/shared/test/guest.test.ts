import { describe, expect, it } from 'vitest'
import { GUEST_JOINS_PER_GROUP_PER_HOUR, GUEST_TOKEN_HEADER, GuestJoinInput } from '../src/guest'

describe('GuestJoinInput', () => {
  it('takes a name to claim, with an optional look and nickname', () => {
    expect(GuestJoinInput.parse({ claim: 'ph_1' })).toEqual({ claim: 'ph_1' })
    expect(GuestJoinInput.parse({ claim: 'ph_1', avatar: { animal: 'fox', color: 'mint' }, nickname: ' Bobby ' })).toEqual({
      claim: 'ph_1', avatar: { animal: 'fox', color: 'mint' }, nickname: 'Bobby',
    })
  })

  it('takes a new name ("I\'m new"), trimmed, with the member-name rules', () => {
    expect(GuestJoinInput.parse({ name: ' Dave ', nickname: null })).toEqual({ name: 'Dave', nickname: null })
    expect(GuestJoinInput.safeParse({ name: '  ' }).success).toBe(false)
    expect(GuestJoinInput.safeParse({ name: 'Dave 🍕' }).success).toBe(false)
    expect(GuestJoinInput.safeParse({ name: 'x'.repeat(25) }).success).toBe(false)
  })

  it('needs exactly one of claim or name', () => {
    expect(GuestJoinInput.safeParse({}).success).toBe(false)
    expect(GuestJoinInput.safeParse({ nickname: 'Bobby' }).success).toBe(false)
    expect(GuestJoinInput.safeParse({ claim: 'ph_1', name: 'Dave' }).success).toBe(false)
    expect(GuestJoinInput.safeParse({ claim: '' }).success).toBe(false)
  })
})

describe('guest constants', () => {
  it('names the header and the hourly join limit', () => {
    expect(GUEST_TOKEN_HEADER).toBe('X-Guest-Token')
    expect(GUEST_JOINS_PER_GROUP_PER_HOUR).toBe(20)
  })
})
