import type { BalancesDTO, ExpenseDTO, FeedItem, FunDTO, GroupDTO, MemberDTO, SettlementDTO } from '@squadsplit/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useApi } from './api'
import { invalidateGroup, queryKeys } from './queryKeys'

// One hook per group read, so every screen shares the same cache entries.

export function useGroup(id: string) {
  const api = useApi()
  return useQuery({ queryKey: queryKeys.group(id), queryFn: () => api.get<GroupDTO>(`/groups/${id}`) })
}

export function useBalances(id: string) {
  const api = useApi()
  return useQuery({ queryKey: queryKeys.balances(id), queryFn: () => api.get<BalancesDTO>(`/groups/${id}/balances`) })
}

export function useExpenses(id: string) {
  const api = useApi()
  return useQuery({ queryKey: queryKeys.expenses(id), queryFn: () => api.get<ExpenseDTO[]>(`/groups/${id}/expenses`) })
}

export function usePendingSettlements(id: string) {
  const api = useApi()
  return useQuery({
    queryKey: queryKeys.pendingSettlements(id),
    queryFn: () => api.get<SettlementDTO[]>(`/groups/${id}/settlements?status=pending`),
  })
}

export function useFun(id: string) {
  const api = useApi()
  return useQuery({ queryKey: queryKeys.fun(id), queryFn: () => api.get<FunDTO>(`/groups/${id}/badges`) })
}

export function useFeed(id: string) {
  const api = useApi()
  return useQuery({ queryKey: queryKeys.feed(id), queryFn: () => api.get<FeedItem[]>(`/groups/${id}/feed`) })
}

/**
 * A change inside the group. Whether it works or not, everything about the group is refetched
 * afterwards: a failure (say, a settlement that is no longer pending) usually means our copy is stale.
 */
export function useGroupMutation<TVars, TResult>(groupId: string, mutationFn: (vars: TVars) => Promise<TResult>) {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn, onSettled: () => invalidateGroup(queryClient, groupId) })
}

/** Names and avatars for everyone in the group's history, including people who have left. */
export interface People {
  /** Current members, in the group's order: the only people who can pay, share or be settled with. */
  active: MemberDTO[]
  name(userId: string): string
  /** "You" for the signed-in user, otherwise their name. Pass `lower` mid-sentence. */
  you(userId: string, lower?: boolean): string
  isFormer(userId: string): boolean
}

export function peopleOf(group: GroupDTO, me: string): People {
  const byId = new Map(group.members.map((m) => [m.userId, m]))
  const name = (userId: string) => byId.get(userId)?.displayName ?? 'Someone'
  return {
    active: group.members.filter((m) => m.active),
    name,
    you: (userId, lower = false) => (userId === me ? (lower ? 'you' : 'You') : name(userId)),
    isFormer: (userId) => byId.get(userId)?.active !== true,
  }
}
