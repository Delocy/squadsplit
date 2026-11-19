import { useAuth } from '@clerk/react'
import { createContext, useContext } from 'react'
import type { GuestPass } from './guestPass'

/**
 * How the pages inside one group reach it: as the signed-in member, or as a guest with this phone's pass (`guest`).
 * Set by GroupLayout. Every API request made inside it carries the guest token when `guest` is set.
 */
export interface GroupAccess {
  groupId: string
  guest: GuestPass | null
}

const GroupAccessContext = createContext<GroupAccess | null>(null)

export const GroupAccessProvider = GroupAccessContext.Provider

/** The group being looked at and how, or null outside a group's pages. */
export const useGroupAccess = () => useContext(GroupAccessContext)

/** Who you are in the group you're looking at: its guest on this phone, or the signed-in user. */
export function useMyId(): string {
  const access = useGroupAccess()
  const { userId } = useAuth()
  return access?.guest?.userId ?? userId ?? ''
}
