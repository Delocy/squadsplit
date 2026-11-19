export type Bindings = {
  DB: D1Database
  /** Workers AI, for receipt scanning. */
  AI: Ai
  CLERK_SECRET_KEY: string
  CLERK_PUBLISHABLE_KEY: string
  WEB_ORIGIN: string
}

export type AppEnv = { Bindings: Bindings; Variables: { userId: string } }
