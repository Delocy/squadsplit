import type { QuickSplitDTO, QuickSplitSummaryDTO } from '@squadsplit/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useApi } from '../api'
import { queryKeys } from '../queryKeys'

/** Your quick splits, newest first. */
export function useQuickSplits() {
  const api = useApi()
  return useQuery({ queryKey: queryKeys.quickSplits, queryFn: () => api.get<QuickSplitSummaryDTO[]>('/quick-splits') })
}

/** One of your quick splits, as its owner sees it. */
export function useQuickSplit(id: string) {
  const api = useApi()
  return useQuery({ queryKey: queryKeys.quickSplit(id), queryFn: () => api.get<QuickSplitDTO>(`/quick-splits/${id}`) })
}

/** After a change the API answered with the whole split: show it at once, and refresh the list (its ticks and totals). */
export function useStoreQuickSplit() {
  const queryClient = useQueryClient()
  return (split: QuickSplitDTO) => {
    queryClient.setQueryData(queryKeys.quickSplit(split.id), split)
    void queryClient.invalidateQueries({ queryKey: queryKeys.quickSplits })
  }
}
