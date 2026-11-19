import { z } from 'zod'
import { AvatarChoice } from './avatar'
import { MemberName, Nickname } from './schemas'

// Guests: friends who open a group's invite link and join without an account, Tricount-style. A guest is a member of
// that one group only, signed in on their phone by a token the API hands out when they join.

/** The request header that carries a guest's token (never a URL). */
export const GUEST_TOKEN_HEADER = 'X-Guest-Token'

/** Guest joins (claims and new names) one group takes per hour, from everyone together. */
export const GUEST_JOINS_PER_GROUP_PER_HOUR = 20

/**
 * Body of `POST /invites/:code/guest`: exactly one of `claim` (the user id of one of the group's unclaimed names) or
 * `name` ("I'm new"). `avatar` and `nickname` follow the rules of joining.
 */
export const GuestJoinInput = z
  .object({
    claim: z.string().min(1).optional(),
    name: MemberName.optional(),
    avatar: AvatarChoice.optional(),
    nickname: Nickname.nullable().optional(),
  })
  .refine((v) => (v.claim === undefined) !== (v.name === undefined), { message: 'Send either a name to claim or a new name' })
export type GuestJoinInput = z.infer<typeof GuestJoinInput>
