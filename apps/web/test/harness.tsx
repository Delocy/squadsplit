import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { vi } from 'vitest'
import { routes } from '../src/routes'

const API = 'http://localhost:8787'

type Handler = (body: unknown) => { status: number; body?: unknown }

/** Stubs global fetch with handlers keyed by "METHOD /path". Unknown routes fail the request loudly. */
export function fakeApi(handlers: Record<string, Handler>) {
  const calls: { key: string; body: unknown; auth: string | null }[] = []
  const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
    const key = `${init?.method ?? 'GET'} ${String(input).replace(API, '')}`
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ key, body, auth: new Headers(init?.headers).get('Authorization') })
    const handler = handlers[key]
    if (!handler) throw new Error(`No fake API handler for ${key}`)
    const res = handler(body)
    return new Response(res.body === undefined ? null : JSON.stringify(res.body), {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetchFn)
  return calls
}

/** Renders the real route tree at `url`. */
export function renderApp(url: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(routes, { initialEntries: [url] })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}
