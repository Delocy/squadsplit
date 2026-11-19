import { SignInButton, useAuth } from '@clerk/react'
import type { GroupDTO } from '@squadsplit/shared'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useLocation } from 'react-router'
import { useApi } from '../api'
import { ErrorNote } from '../components/ErrorNote'
import { BusyLabel } from '../design/Busy'
import { invalidateGroup, queryKeys } from '../queryKeys'
import { useSingleFlightMutation } from '../singleFlight'
import { dropGuestPass } from './guestPass'

// "Save with an account": a guest signs in (or up), then the group moves to their account, history and all. Signing
// in may leave the page (a social login comes back to it), so the wish to save is kept in sessionStorage under
// `squadsplit.guest-upgrade.<groupId>` until it has been tried.

const wishKeyOf = (groupId: string) => `squadsplit.guest-upgrade.${groupId}`

function wishToSave(groupId: string): boolean {
  try {
    return sessionStorage.getItem(wishKeyOf(groupId)) === '1'
  } catch {
    return false
  }
}

function setWish(groupId: string, wish: boolean): void {
  try {
    if (wish) sessionStorage.setItem(wishKeyOf(groupId), '1')
    else sessionStorage.removeItem(wishKeyOf(groupId))
  } catch {
    // Without storage, a guest who signs in presses Save again.
  }
}

/** In a guest's top bar. Signed out, it signs in first; signed in, it saves straight away. */
export function SaveWithAccount({ groupId }: { groupId: string }) {
  const { isSignedIn } = useAuth()
  const api = useApi()
  const queryClient = useQueryClient()
  const { pathname, search } = useLocation()
  const here = `${window.location.origin}${pathname}${search}`
  const save = useSingleFlightMutation({
    mutationFn: () => api.post<GroupDTO>(`/groups/${groupId}/guest/upgrade`),
    onSuccess: (group) => {
      setWish(groupId, false)
      // The pages switch to the account once this pass is gone, and refetch as the account when they remount.
      dropGuestPass(groupId)
      queryClient.setQueryData(queryKeys.group(groupId), group)
      void invalidateGroup(queryClient, groupId, 'none')
    },
    onError: () => setWish(groupId, false),
  })

  // Back from signing in to save: save now.
  const saveNow = Boolean(isSignedIn) && wishToSave(groupId)
  const { mutate } = save
  useEffect(() => {
    if (saveNow) mutate()
  }, [saveNow, mutate])

  const label = (
    <BusyLabel busy={save.isPending} label="Saving…">
      Save with an account
    </BusyLabel>
  )
  return (
    <>
      {isSignedIn ? (
        <button type="button" className="btn small" disabled={save.isPending} onClick={() => save.mutate()}>
          {label}
        </button>
      ) : (
        <SignInButton mode="modal" forceRedirectUrl={here} signUpForceRedirectUrl={here}>
          <button type="button" className="btn small" onClick={() => setWish(groupId, true)}>
            {label}
          </button>
        </SignInButton>
      )}
      {save.isError && <ErrorNote error={save.error} />}
    </>
  )
}
