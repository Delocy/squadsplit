import { z } from 'zod'
import { CATEGORIES, CURRENCIES, type Category, type Currency } from './money'
import { SETTLEMENT_STATUSES, type SettlementStatus, type Transfer } from './ledger'
import type { Badge } from './fun'
import { itemizedTotal, type BillItem } from './itemized'
import { AvatarChoice } from './avatar'
import { MAX_GROUP_MEMBERS } from './limits'

const MAX_CENTS = 100_000_000

const amountCents = z.number().int().min(1).max(MAX_CENTS)
const id = z.string().min(1)

const groupName = z.string().trim().min(1).max(50)

/** Control characters, and invisible format characters: bidi overrides (U+202E), zero-width spaces and joiners. */
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u
/**
 * Anything that draws as emoji: pictographs, flags (regional indicators), keycaps (U+20E3), skin tones, and the
 * emoji-style selector U+FE0F. ™ © ® are pictographs too, but they read as plain text unless U+FE0F follows,
 * which is rejected on its own, so they are allowed.
 */
const EMOJI = /(?![©®™])\p{Extended_Pictographic}|[\p{Regional_Indicator}\p{Emoji_Modifier}⃣️]/u

/**
 * What a member is called inside one group. Trimmed, at most 24 characters; empty means "no nickname" (null),
 * so the profile name shows instead. No control or invisible format characters, and no emoji (the app shows none).
 */
const nameText = z
  .string()
  .trim()
  .max(24)
  .refine((s) => !CONTROL_OR_FORMAT.test(s), { message: 'No control characters' })
  .refine((s) => !EMOJI.test(s), { message: 'No emoji' })
export const Nickname = nameText.transform((s) => (s === '' ? null : s))

/** The name of someone who hasn't joined yet (a placeholder member): the Nickname rules, and it can't be empty. */
export const MemberName = nameText.refine((s) => s.length > 0, { message: 'Enter a name' })
const groupEmoji = z.string().min(1).max(8)
const currency = z.enum(CURRENCIES)

export const CreateGroupInput = z.object({
  name: groupName,
  emoji: groupEmoji,
  currency: currency.default('SGD'),
  /** The owner's nickname in the new group; null or "" for none. */
  nickname: Nickname.nullable().optional(),
  /** Everyone else in the group, by name, until they join and claim it. With the owner, at most MAX_GROUP_MEMBERS. */
  members: z.array(MemberName).max(MAX_GROUP_MEMBERS - 1).optional(),
})
export type CreateGroupInput = z.infer<typeof CreateGroupInput>

export const UpdateGroupInput = z
  .object({ name: groupName, emoji: groupEmoji, currency })
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'At least one field is required' })
export type UpdateGroupInput = z.infer<typeof UpdateGroupInput>

/** Whether `s` is a real calendar day written YYYY-MM-DD. */
export function isRealDate(s: string): boolean {
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

const bps = z.number().int().min(0).max(3000)

const itemizedSplit = z.object({
  type: z.literal('itemized'),
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(60),
        amountCents,
        userIds: z
          .array(id)
          .min(1)
          .refine((ids) => new Set(ids).size === ids.length, { message: 'Duplicate participants' }),
      }),
    )
    .min(1)
    .max(50),
  serviceChargeBps: bps,
  gstBps: bps,
})

export const CreateExpenseInput = z
  .object({
    description: z.string().trim().min(1).max(100),
    amountCents,
    paidBy: id,
    category: z.enum(CATEGORIES),
    spentOn: z.string().refine(isRealDate, { message: 'Must be a valid YYYY-MM-DD date' }),
    currency: currency.optional(),
    split: z.discriminatedUnion('type', [equalSplit, exactSplit, itemizedSplit]),
  })
  .superRefine((v, ctx) => {
    if (v.split.type === 'exact') {
      const sum = v.split.shares.reduce((a, s) => a + s.amountCents, 0)
      if (sum !== v.amountCents) {
        ctx.addIssue({ code: 'custom', path: ['split'], message: 'Shares must add up to the amount' })
      }
    }
    if (v.split.type === 'itemized' && v.amountCents !== itemizedTotal(v.split)) {
      ctx.addIssue({ code: 'custom', path: ['split'], message: 'Amount must equal the itemized total' })
    }
  })
export type CreateExpenseInput = z.infer<typeof CreateExpenseInput>

/** Sent in full (no partial updates). */
export const UpdateExpenseInput = CreateExpenseInput
export type UpdateExpenseInput = CreateExpenseInput

/**
 * `fromUserId` defaults to the caller. Naming someone else is only for a creditor recording that someone who hasn't
 * joined yet (a placeholder) paid them.
 */
export const CreateSettlementInput = z.object({ fromUserId: id.optional(), toUserId: id, amountCents })
export type CreateSettlementInput = z.infer<typeof CreateSettlementInput>
/** Query string of `GET /groups/:id/settlements`. */
export const ListSettlementsQuery = z.object({ status: z.enum(SETTLEMENT_STATUSES).optional() })
export type ListSettlementsQuery = z.infer<typeof ListSettlementsQuery>

/**
 * Body of `POST /invites/:code/join`; the whole body is optional. Without an avatar the server picks a free one.
 * Without a nickname a former member keeps theirs; null or "" means none.
 * `claim` is the user id of a name in the group (a placeholder) that is you: you take over its place, history and
 * look, and its name becomes your nickname unless you send one.
 */
export const JoinGroupInput = z.object({
  avatar: AvatarChoice.optional(),
  nickname: Nickname.nullable().optional(),
  claim: id.optional(),
})
export type JoinGroupInput = z.infer<typeof JoinGroupInput>

/** Body of `PATCH /groups/:id/members/me`. `nickname: null` (or "") clears it. */
export const UpdateMemberInput = z
  .object({ avatar: AvatarChoice.optional(), nickname: Nickname.nullable().optional() })
  .refine((v) => v.avatar !== undefined || v.nickname !== undefined, { message: 'At least one field is required' })
export type UpdateMemberInput = z.infer<typeof UpdateMemberInput>

/** Body of `POST /groups/:id/placeholders` (owner): add someone who hasn't joined yet, by name. */
export const AddPlaceholderInput = z.object({ name: MemberName })
export type AddPlaceholderInput = z.infer<typeof AddPlaceholderInput>

/** Body of `PATCH /me`: your look outside groups, and the one a new group starts you on. */
export const UpdateProfileInput = z.object({ profileAvatar: AvatarChoice })
export type UpdateProfileInput = z.infer<typeof UpdateProfileInput>

// ---- DTOs (types only) ----

/** `profileAvatar`: the look you picked for yourself, or your default. */
export interface MeDTO { id: string; displayName: string; avatarUrl: string | null; profileAvatar: AvatarChoice }
/**
 * A member as the group sees them. `displayName` is the effective name: their `nickname` in this group if they set
 * one, otherwise their profile name. `avatar` is their look in this group: what they picked, or their default.
 * `placeholder`: a name the owner added for someone who hasn't joined yet (they can claim it when they join).
 */
export interface MemberDTO {
  userId: string; displayName: string; nickname: string | null; avatarUrl: string | null
  role: 'owner' | 'member'; active: boolean; avatar: AvatarChoice; placeholder: boolean
}
export interface GroupDTO { id: string; name: string; emoji: string; currency: Currency; inviteCode: string | null; ownerId: string; members: MemberDTO[] }
export interface GroupSummaryDTO { id: string; name: string; emoji: string; currency: Currency; role: 'owner' | 'member'; myBalanceCents: number }
/**
 * `memberCount` and `takenAvatars` include the unclaimed names (placeholders), which count towards the cap.
 * `takenAvatars`: the looks of the group's active members, which a joiner can't pick.
 * `myFormerAvatar`: the look the caller left the group with (their default if they never stored one) when they are a
 * former member, else null. Joining without an avatar gives them it back if it is still free.
 */
export interface InvitePreviewDTO {
  groupId: string; name: string; emoji: string; memberCount: number; alreadyMember: boolean
  takenAvatars: AvatarChoice[]; myFormerAvatar: AvatarChoice | null
  /** The names in the group nobody has claimed yet: "Which one are you?" */
  placeholders: PlaceholderDTO[]
}
export interface PlaceholderDTO { userId: string; name: string; avatar: AvatarChoice }
export interface ExpenseDTO {
  id: string; groupId: string; description: string; amountCents: number; paidBy: string; createdBy: string
  category: Category; spentOn: string; splitType: 'equal' | 'exact' | 'itemized'; shares: { userId: string; amountCents: number }[]
  currency: Currency; fxRatePpm: number; serviceChargeBps: number | null; gstBps: number | null
  items: BillItem[] | null
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
