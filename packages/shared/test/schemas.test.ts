import { describe, expect, it } from 'vitest'
import {
  CreateExpenseInput,
  CreateGroupInput,
  CreateSettlementInput,
  UpdateGroupInput,
} from '../src/schemas'

const base = {
  description: 'Dinner',
  amountCents: 3000,
  paidBy: 'u1',
  category: '🍕',
  spentOn: '2026-03-14',
  split: { type: 'equal', participantIds: ['u1', 'u2'] },
}

describe('CreateExpenseInput', () => {
  it('accepts a valid equal expense', () => {
    expect(CreateExpenseInput.safeParse(base).success).toBe(true)
  })

  it('accepts exact shares that add up', () => {
    const r = CreateExpenseInput.safeParse({
      ...base,
      split: { type: 'exact', shares: [{ userId: 'u1', amountCents: 1000 }, { userId: 'u2', amountCents: 2000 }] },
    })
    expect(r.success).toBe(true)
  })

  it('rejects exact shares that do not add up, on path split', () => {
    const r = CreateExpenseInput.safeParse({
      ...base,
      split: { type: 'exact', shares: [{ userId: 'u1', amountCents: 1000 }, { userId: 'u2', amountCents: 1999 }] },
    })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues.some((i) => i.path.join('.') === 'split')).toBe(true)
  })

  it('rejects duplicate exact share userIds and non-positive shares', () => {
    const dup = CreateExpenseInput.safeParse({
      ...base,
      split: { type: 'exact', shares: [{ userId: 'u1', amountCents: 1500 }, { userId: 'u1', amountCents: 1500 }] },
    })
    expect(dup.success).toBe(false)
    const zero = CreateExpenseInput.safeParse({
      ...base,
      split: { type: 'exact', shares: [{ userId: 'u1', amountCents: 0 }, { userId: 'u2', amountCents: 3000 }] },
    })
    expect(zero.success).toBe(false)
  })

  it('rejects duplicate and empty participants', () => {
    expect(CreateExpenseInput.safeParse({ ...base, split: { type: 'equal', participantIds: ['u1', 'u1'] } }).success).toBe(false)
    expect(CreateExpenseInput.safeParse({ ...base, split: { type: 'equal', participantIds: [] } }).success).toBe(false)
  })

  it('rejects bad category', () => {
    expect(CreateExpenseInput.safeParse({ ...base, category: '🐉' }).success).toBe(false)
  })

  it.each([0, 1.5, 100_000_001])('rejects amountCents %s', (amountCents) => {
    expect(CreateExpenseInput.safeParse({ ...base, amountCents }).success).toBe(false)
  })

  it('accepts the amount bounds 1 and 100_000_000', () => {
    expect(CreateExpenseInput.safeParse({ ...base, amountCents: 1 }).success).toBe(true)
    expect(CreateExpenseInput.safeParse({ ...base, amountCents: 100_000_000 }).success).toBe(true)
  })

  it.each(['2026-02-30', '2026-3-4', 'yesterday', '2026-13-01', ''])('rejects spentOn %s', (spentOn) => {
    expect(CreateExpenseInput.safeParse({ ...base, spentOn }).success).toBe(false)
  })

  it('accepts a leap day', () => {
    expect(CreateExpenseInput.safeParse({ ...base, spentOn: '2028-02-29' }).success).toBe(true)
  })

  it('trims description and rejects blank or >100 chars', () => {
    const ok = CreateExpenseInput.parse({ ...base, description: '  Dinner  ' })
    expect(ok.description).toBe('Dinner')
    expect(CreateExpenseInput.safeParse({ ...base, description: '   ' }).success).toBe(false)
    expect(CreateExpenseInput.safeParse({ ...base, description: 'x'.repeat(101) }).success).toBe(false)
  })
})

describe('CreateGroupInput', () => {
  it('defaults currency to SGD', () => {
    expect(CreateGroupInput.parse({ name: ' Trip ', emoji: '🏝️' })).toEqual({ name: 'Trip', emoji: '🏝️', currency: 'SGD' })
  })

  it('rejects JPY, empty/long name, empty/long emoji', () => {
    expect(CreateGroupInput.safeParse({ name: 'a', emoji: '🏝️', currency: 'JPY' }).success).toBe(false)
    expect(CreateGroupInput.safeParse({ name: '  ', emoji: '🏝️' }).success).toBe(false)
    expect(CreateGroupInput.safeParse({ name: 'x'.repeat(51), emoji: '🏝️' }).success).toBe(false)
    expect(CreateGroupInput.safeParse({ name: 'a', emoji: '' }).success).toBe(false)
    expect(CreateGroupInput.safeParse({ name: 'a', emoji: 'x'.repeat(9) }).success).toBe(false)
  })
})

describe('UpdateGroupInput', () => {
  it('requires at least one field and does not apply the currency default', () => {
    expect(UpdateGroupInput.safeParse({}).success).toBe(false)
    expect(UpdateGroupInput.parse({ name: 'New' })).toEqual({ name: 'New' })
  })
})

describe('CreateSettlementInput', () => {
  it('validates amount and recipient', () => {
    expect(CreateSettlementInput.safeParse({ toUserId: 'u2', amountCents: 500 }).success).toBe(true)
    expect(CreateSettlementInput.safeParse({ toUserId: '', amountCents: 500 }).success).toBe(false)
    for (const amountCents of [0, 1.5, 100_000_001]) {
      expect(CreateSettlementInput.safeParse({ toUserId: 'u2', amountCents }).success).toBe(false)
    }
  })
})
