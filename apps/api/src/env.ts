import type { GuestSession } from './guests/sessions'

export type Bindings = {
  DB: D1Database
  /** Workers AI, for receipt scanning. */
  AI: Ai
  CLERK_SECRET_KEY: string
  CLERK_PUBLISHABLE_KEY: string
  WEB_ORIGIN: string
}

/**
 * `userId`: who is calling (an account's Clerk id, or a guest's id). `guest`: the guest session the request carries,
 * if any. Both are set on a guest saving to an account, where `userId` is the account.
 */
export type AppEnv = { Bindings: Bindings; Variables: { userId: string; guest?: GuestSession } }
