import { afterEach, describe, expect, it, vi } from 'vitest'
import { dropGuestPass, guestPassGroupIds, readGuestPass, saveGuestPass, type GuestPass } from '../src/guest/guestPass'

const pass: GuestPass = { token: 't'.repeat(43), userId: 'gs_1', groupName: 'Bali Trip', code: 'ABCD2345' }

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('guest passes on this phone', () => {
  it('keeps one per group under squadsplit.guest.<groupId>', () => {
    saveGuestPass('g1', pass)
    saveGuestPass('g2', { ...pass, userId: 'gs_2' })
    expect(JSON.parse(localStorage.getItem('squadsplit.guest.g1')!)).toEqual(pass)
    expect(readGuestPass('g1')).toEqual(pass)
    expect(readGuestPass('g2')?.userId).toBe('gs_2')
    expect(guestPassGroupIds().sort()).toEqual(['g1', 'g2'])

    dropGuestPass('g1')
    expect(readGuestPass('g1')).toBeNull()
    expect(guestPassGroupIds()).toEqual(['g2'])
  })

  it('reads anything that isn’t a pass as none', () => {
    localStorage.setItem('squadsplit.guest.g1', 'not json')
    localStorage.setItem('squadsplit.guest.g2', JSON.stringify({ token: 1 }))
    localStorage.setItem('squadsplit.other', 'x')
    expect(readGuestPass('g1')).toBeNull()
    expect(readGuestPass('g2')).toBeNull()
    expect(guestPassGroupIds().sort()).toEqual(['g1', 'g2'])
  })

  it('carries on without storage (private mode, blocked site data)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'key').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => saveGuestPass('g1', pass)).not.toThrow()
    expect(readGuestPass('g1')).toBeNull()
    expect(() => dropGuestPass('g1')).not.toThrow()
    expect(guestPassGroupIds()).toEqual([])
  })
})
