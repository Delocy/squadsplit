import { useAuth } from '@clerk/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { MeDTO } from '@squadsplit/shared'
import { useApi } from './api'
import { invalidateAllGroups, queryKeys } from './queryKeys'

/**
 * Once per signed-in user: GET /me stores their latest Clerk name and avatar, then every group is refetched so
 * the new name shows. A failure is harmless (the API keeps the stored profile), so nothing is shown for it.
 */
export function useProfileRefresh(): void {
  const { isSignedIn, userId } = useAuth()
  const api = useApi()
  const queryClient = useQueryClient()
  const me = useQuery({
    queryKey: queryKeys.me(userId ?? ''),
    queryFn: () => api.get<MeDTO>('/me'),
    enabled: Boolean(isSignedIn && userId),
    staleTime: Infinity,
    gcTime: Infinity,
  })
  const refreshed = me.isSuccess
  useEffect(() => {
    if (refreshed) void invalidateAllGroups(queryClient)
  }, [refreshed, queryClient])
}
