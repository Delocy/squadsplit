export type Cents = number

export const CURRENCIES = ['SGD', 'USD', 'EUR', 'GBP', 'MYR', 'AUD', 'NZD', 'HKD', 'THB'] as const
export type Currency = (typeof CURRENCIES)[number]

export const CATEGORIES = ['🍕', '🍻', '🚕', '🏨', '🛒', '🎟️', '✈️', '💡', '🎁', '💸'] as const
export type Category = (typeof CATEGORIES)[number]

export class SplitError extends Error {
  readonly code = 'AMOUNT_TOO_SMALL' as const
  constructor(message = 'AMOUNT_TOO_SMALL: amount too small to split') {
    super(message)
    this.name = 'SplitError'
  }
}

/**
 * Splits amountCents equally. Everyone gets floor(amount / n); the remainder
 * goes to the payer if they are a participant, else 1 cent each to the first
 * participants in sorted id order.
 */
export function splitEqual(amountCents: Cents, participantIds: string[], payerId: string): Record<string, Cents> {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error('amountCents must be a positive integer')
  }
  const n = participantIds.length
  if (n === 0) throw new Error('participantIds must not be empty')
  if (new Set(participantIds).size !== n) throw new Error('participantIds must be unique')
  if (amountCents < n) throw new SplitError()

  const base = Math.floor(amountCents / n)
  const remainder = amountCents - base * n
  const shares: Record<string, Cents> = {}
  for (const id of participantIds) shares[id] = base

  if (participantIds.includes(payerId)) {
    shares[payerId] = base + remainder
  } else {
    const sorted = [...participantIds].sort()
    for (let i = 0; i < remainder; i++) shares[sorted[i]!] = base + 1
  }
  return shares
}

export function formatMoney(cents: Cents, currency: string): string {
  return new Intl.NumberFormat('en-SG', { style: 'currency', currency }).format(cents / 100)
}
