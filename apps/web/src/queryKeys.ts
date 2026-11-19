import type { QueryClient } from '@tanstack/react-query'

/** Every TanStack Query key the app uses, in one place. */
export const queryKeys = {
  groups: ['groups'] as const,
  invite: (code: string) => ['invite', code] as const,
  group: (id: string) => ['group', id] as const,
  balances: (id: string) => ['balances', id] as const,
  expenses: (id: string) => ['expenses', id] as const,
  pendingSettlements: (id: string) => ['settlements', id, 'pending'] as const,
  fun: (id: string) => ['fun', id] as const,
  feed: (id: string) => ['feed', id] as const,
}

/** After any change inside a group: refetch everything about it, and the group list (it shows your balance). */
export function invalidateGroup(queryClient: QueryClient, id: string): Promise<void> {
  const keys = [
    queryKeys.groups,
    queryKeys.group(id),
    queryKeys.balances(id),
    queryKeys.expenses(id),
    queryKeys.pendingSettlements(id),
    queryKeys.fun(id),
    queryKeys.feed(id),
  ]
  return Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey }))).then(() => undefined)
}
