import { applyD1Migrations, env, reset } from 'cloudflare:test'
import { afterEach, beforeEach } from 'vitest'

// Storage is not isolated per test by default: wipe every binding after each test
// and re-apply migrations (a no-op when the schema survived the wipe) before the next.
beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

afterEach(async () => {
  await reset()
})
