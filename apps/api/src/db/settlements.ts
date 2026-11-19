import type { SettlementDTO } from '@squadsplit/shared'
import type { settlements } from './schema'

export const toSettlementDTO = (s: typeof settlements.$inferSelect): SettlementDTO => ({
  id: s.id,
  groupId: s.groupId,
  fromUserId: s.fromUserId,
  toUserId: s.toUserId,
  amountCents: s.amountCents,
  status: s.status,
  createdAt: s.createdAt,
  resolvedAt: s.resolvedAt,
})
