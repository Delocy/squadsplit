import { useMutation, type UseMutationOptions, type UseMutationResult } from '@tanstack/react-query'
import { useCallback, useEffect, useRef } from 'react'

/**
 * useMutation whose `mutate` ignores a press while the last one is still waiting on the server. Buttons are
 * disabled while a mutation is pending, but a double tap can land before React re-renders them disabled;
 * this makes sure it still sends one request.
 */
export function useSingleFlightMutation<TData, TVariables>(
  options: UseMutationOptions<TData, Error, TVariables>,
): UseMutationResult<TData, Error, TVariables> {
  const mutation = useMutation(options)
  const inFlight = useRef(false)
  const { mutate, isPending, submittedAt } = mutation
  // Free again once the mutation has settled or been reset. submittedAt tells mutations apart, so one that settles
  // before React renders it as pending still frees the next press.
  useEffect(() => {
    if (!isPending) inFlight.current = false
  }, [isPending, submittedAt])
  const mutateOnce = useCallback(
    (...args: Parameters<typeof mutate>) => {
      if (inFlight.current) return
      inFlight.current = true
      mutate(...args)
    },
    [mutate],
  )
  return { ...mutation, mutate: mutateOnce }
}
