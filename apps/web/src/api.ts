import { useAuth } from '@clerk/react'
import { useMemo } from 'react'
import type { ApiErrorBody } from '@squadsplit/shared'

/**
 * A failed API call. For a non-2xx response, `code` and `message` come from the API's `{ error }` body when it has one.
 * When the request never reached the API (offline, DNS, CORS), `status` is 0 and `code` is `network`.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export interface ApiClient {
  get<T>(path: string): Promise<T>
  post<T>(path: string, body?: unknown): Promise<T>
  patch<T>(path: string, body: unknown): Promise<T>
  del(path: string): Promise<void>
}

const isErrorBody = (v: unknown): v is ApiErrorBody =>
  typeof v === 'object' && v !== null && 'error' in v && typeof (v as ApiErrorBody).error?.code === 'string'

export function createApiClient(
  baseUrl: string,
  getToken: () => Promise<string | null>,
  fetchFn: typeof fetch = fetch,
): ApiClient {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers = new Headers()
    const token = await getToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
    if (body !== undefined) headers.set('Content-Type', 'application/json')

    let res: Response
    try {
      res = await fetchFn(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch (err) {
      // fetch rejects with a TypeError when the request fails before any response.
      if (err instanceof TypeError) throw new ApiError(0, 'network', "Can't reach SquadSplit right now.")
      throw err
    }
    const text = await res.text()
    let data: unknown = undefined
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        data = undefined
      }
    }
    if (!res.ok) {
      if (isErrorBody(data)) throw new ApiError(res.status, data.error.code, data.error.message)
      throw new ApiError(res.status, 'http_error', res.statusText || `Request failed (${res.status})`)
    }
    return data as T
  }

  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    patch: (path, body) => request('PATCH', path, body),
    del: async (path) => {
      await request<void>('DELETE', path)
    },
  }
}

/** A 4xx (not a member, dead invite, validation) will not change on retry; network and 5xx errors might. */
export function isRetryable(error: unknown): boolean {
  return !(error instanceof ApiError && error.status >= 400 && error.status < 500)
}

/** The API origin from VITE_API_URL: empty counts as unset, and trailing slashes are dropped. */
export function apiBaseUrl(raw: string | undefined): string {
  const url = raw?.trim() || 'http://localhost:8787'
  return url.replace(/\/+$/, '')
}

const API_URL = apiBaseUrl(import.meta.env.VITE_API_URL)

/** The API client for the signed-in user: every request carries their Clerk session token. */
export function useApi(): ApiClient {
  const { getToken } = useAuth()
  return useMemo(() => createApiClient(API_URL, () => getToken()), [getToken])
}
