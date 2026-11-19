import { z } from 'zod'
import { CATEGORIES, CURRENCIES, type Category, type Currency } from './money'
import type { SettlementStatus, Transfer } from './ledger'
import type { Badge } from './fun'

const MAX_CENTS = 100_000_000

const amountCents = z.number().int().min(1).max(MAX_CENTS)
const id = z.string().min(1)

const groupName = z.string().trim().min(1).max(50)
const groupEmoji = z.string().min(1).max(8)
const currency = z.enum(CURRENCIES)

export const CreateGroupInput = z.object({
  name: groupName,
  emoji: groupEmoji,
  currency: currency.default('SGD'),
})
export type CreateGroupInput = z.infer<typeof CreateGroupInput>

export const UpdateGroupInput = z
  .object({ name: groupName, emoji: groupEmoji, currency })
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'At least one field is required' })
export type UpdateGroupInput = z.infer<typeof UpdateGroupInput>

function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

const equalSplit = z.object({
  type: z.literal('equal'),
  participantIds: z
    .array(id)
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'Duplicate participants' }),
})

const exactSplit = z.object({
  type: z.literal('exact'),
  shares: z
    .array(z.object({ userId: id, amountCents: z.number().int().min(1) }))
    .min(1)
    .refine((s) => new Set(s.map((x) => x.userId)).size === s.length, { message: 'Duplicate participants' }),
})

export const CreateExpenseInput = z
  .object({
    description: z.string().trim().min(1).max(100),
    amountCents,
    paidBy: id,
    category: z.enum(CATEGORIES),
    spentOn: z.string().refine(isRealDate, { message: 'Must be a valid YYYY-MM-DD date' }),
    split: z.discriminatedUnion('type', [equalSplit, exactSplit]),
  })
  .superRefine((v, ctx) => {
    if (v.split.type === 'exact') {
      const sum = v.split.shares.reduce((a, s) => a + s.amountCents, 0)
      if (sum !== v.amountCents) {
        ctx.addIssue({ code: 'custom', path: ['split'], message: 'Shares must add up to the amount' })
      }
    }
  })
export type CreateExpenseInput = z.infer<typeof CreateExpenseInput>

/** Sent in full (no partial updates). */
export const UpdateExpenseInput = CreateExpenseInput
export type UpdateExpenseInput = CreateExpenseInput

export const CreateSettlementInput = z.object({ toUserId: id, amountCents })
export type CreateSettlementInput = z.infer<typeof CreateSettlementInput>

// ---- DTOs (types only) ----

export interface MeDTO { id: string; displayName: string; avatarUrl: string | null }
export interface MemberDTO { userId: string; displayName: string; avatarUrl: string | null; role: 'owner' | 'member'; active: boolean }
export interface GroupDTO { id: string; name: string; emoji: string; currency: Currency; inviteCode: string | null; ownerId: string; members: MemberDTO[] }
export interface GroupSummaryDTO { id: string; name: string; emoji: string; currency: Currency; role: 'owner' | 'member'; myBalanceCents: number }
export interface InvitePreviewDTO { groupId: string; name: string; emoji: string; memberCount: number; alreadyMember: boolean }
export interface ExpenseDTO {
  id: string; groupId: string; description: string; amountCents: number; paidBy: string; createdBy: string
  category: Category; spentOn: string; splitType: 'equal' | 'exact'; shares: { userId: string; amountCents: number }[]
  locked: boolean; createdAt: string; updatedAt: string
}
export interface SettlementDTO {
  id: string; groupId: string; fromUserId: string; toUserId: string; amountCents: number
  status: SettlementStatus; createdAt: string; resolvedAt: string | null
}
export interface BalancesDTO { balances: Record<string, number>; suggestions: Transfer[] }
export interface LeaderboardEntry { userId: string; netCents: number; rank: number }
export interface FunDTO { badges: Badge[]; leaderboard: LeaderboardEntry[] }
export interface SpinDTO { id: string; groupId: string; spunBy: string; winnerId: string; weights: Record<string, number>; createdAt: string }
export type FeedItem =
  | { type: 'expense'; at: string; expense: ExpenseDTO }
  | { type: 'settlement'; at: string; settlement: SettlementDTO }
  | { type: 'spin'; at: string; spin: SpinDTO }
  | { type: 'join'; at: string; userId: string }
export interface ApiErrorBody { error: { code: string; message: string } }
