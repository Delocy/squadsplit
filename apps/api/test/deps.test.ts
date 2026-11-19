import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Bindings } from '../src/env'

const clerkVerifyToken = vi.hoisted(() => vi.fn())
const clerkGetUser = vi.hoisted(() => vi.fn())
vi.mock('@clerk/backend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@clerk/backend')>()),
  verifyToken: clerkVerifyToken,
  createClerkClient: () => ({ users: { getUser: clerkGetUser } }),
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
  AI: {} as Ai,
  CLERK_SECRET_KEY: 'sk_test_unused',
  CLERK_PUBLISHABLE_KEY: 'pk_test_unused',
  WEB_ORIGIN: 'http://localhost:5173',
}

afterEach(() => {
  vi.restoreAllMocks()
  clerkVerifyToken.mockReset()
  clerkGetUser.mockReset()
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

  it('returns null for a pending session (sign-up or a session task not finished yet)', async () => {
    clerkVerifyToken.mockResolvedValue({ sub: 'user_123', sts: 'pending' })
    expect(await (await clerkDeps(env)).verifyToken('pending-token')).toBeNull()
  })

  it('accepts an active session', async () => {
    clerkVerifyToken.mockResolvedValue({ sub: 'user_123', sts: 'active' })
    expect(await (await clerkDeps(env)).verifyToken('active-token')).toBe('user_123')
  })
})

describe('clerkDeps(env).fetchProfile', () => {
  const email = (emailAddress: string) => ({ emailAddress })
  const clerkUser = (fields: Record<string, unknown>) => ({
    fullName: null,
    firstName: null,
    username: null,
    primaryEmailAddress: null,
    emailAddresses: [],
    imageUrl: 'https://img.clerk.com/u1',
    ...fields,
  })

  it.each([
    ['the full name', { fullName: 'Alice Tan', firstName: 'Alice', username: 'alicet' }, 'Alice Tan'],
    ['the first name when there is no full name', { firstName: 'Alice', username: 'alicet' }, 'Alice'],
    ['the username when there is no name', { username: 'alicet', primaryEmailAddress: email('alice@example.com') }, 'alicet'],
    [
      'the part of the primary email before the @, never the whole address',
      { primaryEmailAddress: email('alice.tan@example.com'), emailAddresses: [email('old@example.com'), email('alice.tan@example.com')] },
      'alice.tan',
    ],
    ['the first email when none is marked primary', { emailAddresses: [email('bob@example.com')] }, 'bob'],
    ['"Someone" when there is nothing to go on', {}, 'Someone'],
  ])('uses %s', async (_case, fields, displayName) => {
    clerkGetUser.mockResolvedValue(clerkUser(fields))
    const profile = await (await clerkDeps(env)).fetchProfile('user_1')
    expect(clerkGetUser).toHaveBeenCalledWith('user_1')
    expect(profile).toEqual({ displayName, avatarUrl: 'https://img.clerk.com/u1' })
  })
})
