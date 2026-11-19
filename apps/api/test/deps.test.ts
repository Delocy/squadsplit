import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Bindings } from '../src/env'

const clerkVerifyToken = vi.hoisted(() => vi.fn())
vi.mock('@clerk/backend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@clerk/backend')>()),
  verifyToken: clerkVerifyToken,
}))

// The pool preloads the main Worker (src/index.ts), so src/deps.ts is already cached with the real
// @clerk/backend. Reset the module registry and re-import it so it picks up the mock.
async function clerkDeps(env: Bindings) {
  vi.resetModules()
  const deps = await import('../src/deps')
  return deps.clerkDeps(env)
}

const env: Bindings = {
  DB: {} as D1Database,
  CLERK_SECRET_KEY: 'sk_test_unused',
  CLERK_PUBLISHABLE_KEY: 'pk_test_unused',
  WEB_ORIGIN: 'http://localhost:5173',
}

afterEach(() => {
  vi.restoreAllMocks()
  clerkVerifyToken.mockReset()
})

describe('clerkDeps(env).verifyToken', () => {
  it('returns the subject of a valid token', async () => {
    clerkVerifyToken.mockResolvedValue({ sub: 'user_123' })
    expect(await (await clerkDeps(env)).verifyToken('valid-token')).toBe('user_123')
    expect(clerkVerifyToken).toHaveBeenCalledWith('valid-token', {
      secretKey: 'sk_test_unused',
      authorizedParties: ['http://localhost:5173'],
    })
  })

  it('returns null on failure and logs the reason without the token', async () => {
    const token = 'secret-session-token-abc'
    clerkVerifyToken.mockRejectedValue({ reason: 'jwk-remote-failed-to-load' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(await (await clerkDeps(env)).verifyToken(token)).toBeNull()

    expect(warn).toHaveBeenCalledWith(expect.any(String), 'jwk-remote-failed-to-load')
    expect(JSON.stringify(warn.mock.calls)).not.toContain(token)
  })
})
