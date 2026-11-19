import { useAuth } from '@clerk/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { MeDTO } from '@squadsplit/shared'
import { useApi } from './api'
import { invalidateAllGroups, queryKeys } from './queryKeys'

/** The signed-in user's profile from `GET /me` (their Clerk name), fetched once and shared by every screen. */
export function useMe() {
  const { isSignedIn, userId } = useAuth()
  const api = useApi()
  return useQuery({
    queryKey: queryKeys.me(userId ?? ''),
    queryFn: () => api.get<MeDTO>('/me'),
    enabled: Boolean(isSignedIn && userId),
    staleTime: Infinity,
    gcTime: Infinity,
  })
}

/**
 * Once per signed-in user: GET /me stores their latest Clerk name and avatar, then every group is refetched so
 * the new name shows. A failure is harmless (the API keeps the stored profile), so nothing is shown for it.
 */
export function useProfileRefresh(): void {
  const queryClient = useQueryClient()
  const me = useMe()
  const refreshed = me.isSuccess
  useEffect(() => {
    if (refreshed) void invalidateAllGroups(queryClient)
  }, [refreshed, queryClient])
}
