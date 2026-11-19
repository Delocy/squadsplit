import type { BalancesDTO, ExpenseDTO, FeedItem, FunDTO, GroupDTO, SettlementDTO } from '@squadsplit/shared'
import { ME } from './clerk-mock'
import type { Handler } from './harness'

export const BOB = 'user_bob'
/** A former member: still in the history, never offered as payer or participant. */
export const CAROL = 'user_carol'

export const group = (over: Partial<GroupDTO> = {}): GroupDTO => ({
  id: 'g1',
  name: 'Bali Trip',
  emoji: '🧡',
  currency: 'SGD',
  inviteCode: 'ABCD2345',
  ownerId: ME,
  members: [
    { userId: ME, displayName: 'Alice', avatarUrl: null, role: 'owner', active: true },
    { userId: BOB, displayName: 'Bob', avatarUrl: null, role: 'member', active: true },
    { userId: CAROL, displayName: 'Carol', avatarUrl: null, role: 'member', active: false },
  ],
  ...over,
})

export const expense = (over: Partial<ExpenseDTO> = {}): ExpenseDTO => ({
  id: 'e1',
  groupId: 'g1',
  description: 'Dinner',
  amountCents: 1000,
  paidBy: ME,
  createdBy: ME,
  category: '🍕',
  spentOn: '2026-11-18',
  splitType: 'equal',
  shares: [
    { userId: ME, amountCents: 500 },
    { userId: BOB, amountCents: 500 },
  ],
  currency: 'SGD',
  fxRatePpm: 1_000_000,
  serviceChargeBps: null,
  gstBps: null,
  items: null,
  locked: false,
  createdAt: '2026-11-18T10:00:00.000Z',
  updatedAt: '2026-11-18T10:00:00.000Z',
  ...over,
})

export const settlement = (over: Partial<SettlementDTO> = {}): SettlementDTO => ({
  id: 's1',
  groupId: 'g1',
  fromUserId: BOB,
  toUserId: ME,
  amountCents: 1200,
  status: 'pending',
  createdAt: '2026-11-19T09:00:00.000Z',
  resolvedAt: null,
  ...over,
})

export interface GroupState {
  group?: GroupDTO
  balances?: BalancesDTO
  expenses?: ExpenseDTO[]
  pending?: SettlementDTO[]
  fun?: FunDTO
  feed?: FeedItem[]
}

/** Fake API handlers for every read the group home makes, plus any extra (or overriding) handlers. */
export function groupHandlers(state: GroupState = {}, extra: Record<string, Handler> = {}): Record<string, Handler> {
  const ok = (body: unknown) => () => ({ status: 200, body })
  return {
    'GET /groups/g1': ok(state.group ?? group()),
    'GET /groups/g1/balances': ok(state.balances ?? { balances: {}, suggestions: [] }),
    'GET /groups/g1/expenses': ok(state.expenses ?? []),
    'GET /groups/g1/settlements?status=pending': ok(state.pending ?? []),
    'GET /groups/g1/badges': ok(state.fun ?? { badges: [], leaderboard: [] }),
    'GET /groups/g1/feed': ok(state.feed ?? []),
    'GET /groups': ok([]),
    ...extra,
  }
}
