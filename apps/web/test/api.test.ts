import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiBaseUrl, createApiClient, isRetryable, useApi } from '../src/api'

vi.mock('@clerk/react', () => ({ useAuth: () => ({ getToken: async () => 'clerk_session_token' }) }))

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function setup(response: Response, token: string | null = 'tok_123') {
  const fetchFn = vi.fn<typeof fetch>(async () => response)
  const api = createApiClient('http://api.test', async () => token, fetchFn)
  const call = () => {
    const [url, init] = fetchFn.mock.calls[0]!
    return { url, init: init!, headers: new Headers(init!.headers) }
  }
  return { api, fetchFn, call }
}

describe('createApiClient', () => {
  it('sends the bearer token and parses the JSON body', async () => {
    const { api, call } = setup(json(200, [{ id: 'g1' }]))
    await expect(api.get('/groups')).resolves.toEqual([{ id: 'g1' }])
    const { url, init, headers } = call()
    expect(url).toBe('http://api.test/groups')
    expect(init.method).toBe('GET')
    expect(headers.get('Authorization')).toBe('Bearer tok_123')
  })

  it('omits the Authorization header when there is no token', async () => {
    const { api, call } = setup(json(200, {}), null)
    await api.get('/me')
    expect(call().headers.has('Authorization')).toBe(false)
  })

  it('sends a JSON body on post and patch', async () => {
    const post = setup(json(201, { id: 'g1' }))
    await expect(post.api.post('/groups', { name: 'Bali' })).resolves.toEqual({ id: 'g1' })
    expect(post.call().init.method).toBe('POST')
    expect(post.call().init.body).toBe('{"name":"Bali"}')
    expect(post.call().headers.get('Content-Type')).toBe('application/json')

    const patch = setup(json(200, { id: 'g1' }))
    await patch.api.patch('/groups/g1', { name: 'Bali 2' })
    expect(patch.call().init.method).toBe('PATCH')
    expect(patch.call().init.body).toBe('{"name":"Bali 2"}')
  })

  it('posts without a body when none is given', async () => {
    const { api, call } = setup(json(200, { groupId: 'g1' }))
    await api.post('/invites/ABC/join')
    expect(call().init.body).toBeUndefined()
    expect(call().headers.has('Content-Type')).toBe(false)
  })

  it('resolves del on a 204 with no body', async () => {
    const { api, call } = setup(new Response(null, { status: 204 }))
    await expect(api.del('/groups/g1/members/u1')).resolves.toBeUndefined()
    expect(call().init.method).toBe('DELETE')
  })

  it('throws an ApiError carrying the status, code and message of an {error} body', async () => {
    const { api } = setup(json(409, { error: { code: 'balance_not_zero', message: 'Settle up first' } }))
    const err = await api.del('/groups/g1/members/u1').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 409, code: 'balance_not_zero', message: 'Settle up first' })
  })

  it('throws an ApiError with a fallback code when the error body is not JSON', async () => {
    const { api } = setup(new Response('Bad gateway', { status: 502 }))
    await expect(api.get('/groups')).rejects.toMatchObject({ status: 502, code: 'http_error' })
  })

  it('throws a friendly network ApiError when the request never reaches the API', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => {
      throw new TypeError('Failed to fetch')
    })
    const api = createApiClient('http://api.test', async () => 'tok_123', fetchFn)
    const err = await api.get('/groups').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 0, code: 'network', message: "Can't reach SquadSplit right now." })
  })
})

describe('isRetryable', () => {
  it('retries network failures and server errors, but not 4xx answers that will not change', () => {
    expect(isRetryable(new ApiError(0, 'network', "Can't reach SquadSplit right now."))).toBe(true)
    expect(isRetryable(new ApiError(502, 'http_error', 'Bad gateway'))).toBe(true)
    expect(isRetryable(new Error('something else'))).toBe(true)
    expect(isRetryable(new ApiError(404, 'not_found', 'Not found'))).toBe(false)
    expect(isRetryable(new ApiError(422, 'validation_failed', 'Bad input'))).toBe(false)
  })
})

describe('useApi', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('calls VITE_API_URL with the Clerk session token', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => json(200, { id: 'u1' }))
    vi.stubGlobal('fetch', fetchFn)
    const { result } = renderHook(() => useApi())
    await expect(result.current.get('/me')).resolves.toEqual({ id: 'u1' })
    const [url, init] = fetchFn.mock.calls[0]!
    expect(url).toBe('http://localhost:8787/me')
    expect(new Headers(init!.headers).get('Authorization')).toBe('Bearer clerk_session_token')
  })
})

describe('apiBaseUrl', () => {
  it('falls back to the local API when VITE_API_URL is unset or empty', () => {
    expect(apiBaseUrl(undefined)).toBe('http://localhost:8787')
    expect(apiBaseUrl('')).toBe('http://localhost:8787')
    expect(apiBaseUrl('  ')).toBe('http://localhost:8787')
  })

  it('strips trailing slashes so paths join cleanly', () => {
    expect(apiBaseUrl('https://api.example.com/')).toBe('https://api.example.com')
    expect(apiBaseUrl('https://api.example.com//')).toBe('https://api.example.com')
    expect(apiBaseUrl('https://api.example.com')).toBe('https://api.example.com')
  })
})

describe('createApiClient with a guest', () => {
  function guestSetup(response: Response, guestToken: string | null, bearer: string | null = null) {
    const fetchFn = vi.fn<typeof fetch>(async () => response)
    const signedOut = vi.fn()
    const api = createApiClient('http://api.test', async () => bearer, fetchFn, { token: () => guestToken, signedOut })
    const headers = () => new Headers(fetchFn.mock.calls[0]![1]!.headers)
    return { api, signedOut, headers }
  }

  it('adds the X-Guest-Token header, never in the URL', async () => {
    const { api, headers } = guestSetup(json(200, {}), 'guest_tok')
    await api.get('/groups/g1')
    expect(headers().get('X-Guest-Token')).toBe('guest_tok')
    expect(headers().has('Authorization')).toBe(false)
  })

  it('sends both when the phone is signed in too (an account that is only a guest in this group)', async () => {
    const { api, headers } = guestSetup(json(200, {}), 'guest_tok', 'clerk_tok')
    await api.post('/groups/g1/guest/upgrade')
    expect(headers().get('X-Guest-Token')).toBe('guest_tok')
    expect(headers().get('Authorization')).toBe('Bearer clerk_tok')
  })

  it('says the guest was signed out when the API answers 401 guest_signed_out', async () => {
    const { api, signedOut } = guestSetup(json(401, { error: { code: 'guest_signed_out', message: 'Signed out' } }), 'guest_tok')
    await expect(api.get('/groups/g1')).rejects.toMatchObject({ status: 401, code: 'guest_signed_out' })
    expect(signedOut).toHaveBeenCalledOnce()
  })

  it('keeps the guest signed in on any other 401 (an account sign-in that failed, an account-only route)', async () => {
    for (const body of [{ error: { code: 'unauthenticated', message: 'Sign in required' } }, {}]) {
      const { api, signedOut } = guestSetup(json(401, body), 'guest_tok', 'clerk_tok')
      await expect(api.post('/groups/g1/guest/upgrade')).rejects.toMatchObject({ status: 401 })
      expect(signedOut).not.toHaveBeenCalled()
    }
  })

  it('sends no header and reports nothing without a token', async () => {
    const { api, signedOut, headers } = guestSetup(json(401, {}), null)
    await expect(api.get('/groups/g1')).rejects.toMatchObject({ status: 401 })
    expect(headers().has('X-Guest-Token')).toBe(false)
    expect(signedOut).not.toHaveBeenCalled()
  })
})
