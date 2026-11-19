import { defaultAvatar, type AvatarChoice, type BalancesDTO, type ExpenseDTO, type FeedItem, type FunDTO, type GroupDTO, type MemberDTO, type SettlementDTO } from '@squadsplit/shared'
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useApi, type ApiClient } from './api'
import { invalidateGroup, queryKeys } from './queryKeys'
import { useSingleFlightMutation } from './singleFlight'

/**
 * How long a group read counts as fresh. A page opened just after its data was prefetched (see usePrefetchGroup)
 * uses that data instead of fetching it again. Changes in the group still refetch at once (invalidateGroup).
 */
export const GROUP_STALE_MS = 15_000

// One query per group read, so every screen (and the prefetch) shares the same cache entries.
const groupQuery = (api: ApiClient, id: string) =>
  queryOptions({ queryKey: queryKeys.group(id), queryFn: () => api.get<GroupDTO>(`/groups/${id}`), staleTime: GROUP_STALE_MS })

const balancesQuery = (api: ApiClient, id: string) =>
  queryOptions({
    queryKey: queryKeys.balances(id),
    queryFn: () => api.get<BalancesDTO>(`/groups/${id}/balances`),
    staleTime: GROUP_STALE_MS,
  })

const expensesQuery = (api: ApiClient, id: string) =>
  queryOptions({
    queryKey: queryKeys.expenses(id),
    queryFn: () => api.get<ExpenseDTO[]>(`/groups/${id}/expenses`),
    staleTime: GROUP_STALE_MS,
  })

const pendingSettlementsQuery = (api: ApiClient, id: string) =>
  queryOptions({
    queryKey: queryKeys.pendingSettlements(id),
    queryFn: () => api.get<SettlementDTO[]>(`/groups/${id}/settlements?status=pending`),
    staleTime: GROUP_STALE_MS,
  })

const funQuery = (api: ApiClient, id: string) =>
  queryOptions({ queryKey: queryKeys.fun(id), queryFn: () => api.get<FunDTO>(`/groups/${id}/badges`), staleTime: GROUP_STALE_MS })

const feedQuery = (api: ApiClient, id: string) =>
  queryOptions({ queryKey: queryKeys.feed(id), queryFn: () => api.get<FeedItem[]>(`/groups/${id}/feed`), staleTime: GROUP_STALE_MS })

export const useGroup = (id: string) => useQuery(groupQuery(useApi(), id))
export const useBalances = (id: string) => useQuery(balancesQuery(useApi(), id))
/** The group's balances if a page has loaded them already; never fetches them itself. */
export const useCachedBalances = (id: string) => useQuery({ ...balancesQuery(useApi(), id), enabled: false })
export const useExpenses = (id: string) => useQuery(expensesQuery(useApi(), id))
export const usePendingSettlements = (id: string) => useQuery(pendingSettlementsQuery(useApi(), id))
export const useFun = (id: string) => useQuery(funQuery(useApi(), id))
export const useFeed = (id: string) => useQuery(feedQuery(useApi(), id))

/**
 * Starts loading what a group's home page waits for before it shows (the group, balances, expenses, pending
 * settlements and feed), for a link that is about to be followed. Data that is still fresh is not fetched again, so calling it on every hover is cheap.
 */
export function usePrefetchGroup(): (id: string) => void {
  const api = useApi()
  const queryClient = useQueryClient()
  return useCallback(
    (id: string) => {
      void queryClient.prefetchQuery(groupQuery(api, id))
      void queryClient.prefetchQuery(balancesQuery(api, id))
      void queryClient.prefetchQuery(expensesQuery(api, id))
      void queryClient.prefetchQuery(pendingSettlementsQuery(api, id))
      void queryClient.prefetchQuery(feedQuery(api, id))
    },
    [api, queryClient],
  )
}

/**
 * A change inside the group. Whether it works or not, everything about the group is refetched
 * afterwards: a failure (say, a settlement that is no longer pending) usually means our copy is stale.
 * A second press while it is in flight is ignored (see useSingleFlightMutation).
 */
export function useGroupMutation<TVars, TResult>(groupId: string, mutationFn: (vars: TVars) => Promise<TResult>) {
  const queryClient = useQueryClient()
  return useSingleFlightMutation({ mutationFn, onSettled: () => invalidateGroup(queryClient, groupId) })
}

/** Names and avatars for everyone in the group's history, including people who have left. */
export interface People {
  /** Current members, in the group's order: the only people who can pay, share or be settled with. */
  active: MemberDTO[]
  /** Their name in this group: their nickname if they set one, otherwise their profile name. */
  name(userId: string): string
  /** Their look in this group; the default look for someone the group doesn't know. */
  avatar(userId: string): AvatarChoice
  /** "You" for the signed-in user, otherwise their name. Pass `lower` mid-sentence. */
  you(userId: string, lower?: boolean): string
  isFormer(userId: string): boolean
  /** A name the owner added for someone who hasn't joined yet. */
  isPlaceholder(userId: string): boolean
}

export function peopleOf(group: GroupDTO, me: string): People {
  const byId = new Map(group.members.map((m) => [m.userId, m]))
  const name = (userId: string) => byId.get(userId)?.displayName ?? 'Someone'
  return {
    active: group.members.filter((m) => m.active),
    name,
    avatar: (userId) => byId.get(userId)?.avatar ?? defaultAvatar(userId),
    you: (userId, lower = false) => (userId === me ? (lower ? 'you' : 'You') : name(userId)),
    isFormer: (userId) => byId.get(userId)?.active !== true,
    isPlaceholder: (userId) => byId.get(userId)?.placeholder === true,
  }
}

/**
 * Someone in the expense (payer, a share or an item) who has left the group, if any. Like a lock, this
 * stops edit and delete: re-splitting would move a balance nobody can settle any more. The API enforces it too.
 */
export function formerMemberIn(e: ExpenseDTO, people: People): string | null {
  const ids = [e.paidBy, ...e.shares.map((s) => s.userId), ...(e.items ?? []).flatMap((i) => i.userIds)]
  return ids.find((id) => people.isFormer(id)) ?? null
}
