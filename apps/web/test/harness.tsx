import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { vi } from 'vitest'
import { defaultAvatar } from '@squadsplit/shared'
import { routes } from '../src/routes'
import { ME } from './clerk-mock'

const API = 'http://localhost:8787'

type Reply = { status: number; body?: unknown }
export type Handler = (body: unknown) => Reply | Promise<Reply>

/** What `GET /me` answers unless a test brings its own handler: the signed-in user's profile. */
const defaultMe: Handler = () => ({ status: 200, body: { id: ME, displayName: 'Me', avatarUrl: null, profileAvatar: defaultAvatar(ME) } })

/**
 * Stubs global fetch with handlers keyed by "METHOD /path". Unknown routes fail the request loudly.
 *
 * Every signed-in page refreshes the profile with `GET /me`. Unless the test passes its own `GET /me` handler, that
 * call succeeds with a default profile and is left out of `calls`, so `calls` holds only what the page itself sent.
 */
export function fakeApi(handlers: Record<string, Handler>) {
  const calls: { key: string; body: unknown; auth: string | null }[] = []
  const recordMe = 'GET /me' in handlers
  const all: Record<string, Handler> = { 'GET /me': defaultMe, ...handlers }
  const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
    const key = `${init?.method ?? 'GET'} ${String(input).replace(API, '')}`
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    if (key !== 'GET /me' || recordMe) calls.push({ key, body, auth: new Headers(init?.headers).get('Authorization') })
    const handler = all[key]
    if (!handler) throw new Error(`No fake API handler for ${key}`)
    const res = await handler(body)
    return new Response(res.body === undefined ? null : JSON.stringify(res.body), {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetchFn)
  return calls
}

/** Renders the real route tree at `url`. Pass `queryClient` to reach the cache from the test (to refetch, say). */
export function renderApp(url: string, queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const router = createMemoryRouter(routes, { initialEntries: [url] })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

/** A handler that holds its reply until `release` is called, so a test can look at the page while a request is out. */
export function held(reply: Awaited<ReturnType<Handler>>) {
  let release = () => {}
  const gate = new Promise<void>((resolve) => (release = resolve))
  const handler: Handler = async () => {
    await gate
    return reply
  }
  return { handler, release }
}

/**
 * Finds a settle-up transfer by its line, "Dave → You": each name is its own (truncating) element, so the line is
 * matched on the whole `.t` rather than one text node.
 */
export const transferLine = (text: string) => (_: string, el: Element | null) => el?.matches('.row .t') === true && el.textContent === text
