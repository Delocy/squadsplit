import { ApiError } from './api'

/**
 * Plain words for a blocked leave or removal (the API's 409 codes). `removing` is the name of the member
 * the owner is removing, or null when you are leaving yourself. Anything else shows the API's own message.
 */
export function membershipErrorText(error: unknown, removing: string | null): string {
  const code = error instanceof ApiError ? error.code : null
  if (code === 'balance_not_zero') return removing ? `${removing} needs to settle up first` : 'Settle up before leaving'
  if (code === 'pending_settlement') return 'Finish the pending payment first'
  if (code === 'name_in_use') return `${removing ?? 'That name'} is already in the group's history, so the name stays until they join.`
  if (code === 'owner_cannot_leave') return "The owner can't leave the group"
  return error instanceof Error ? error.message : 'Something went wrong.'
}
