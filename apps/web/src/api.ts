import { useAuth } from '@clerk/react'
import { useMemo } from 'react'
import type { ApiErrorBody } from '@squadsplit/shared'

/** A non-2xx API response. `code` and `message` come from the API's `{ error }` body when it has one. */
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

    const res = await fetchFn(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
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

const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:8787'

/** The API client for the signed-in user: every request carries their Clerk session token. */
export function useApi(): ApiClient {
  const { getToken } = useAuth()
  return useMemo(() => createApiClient(API_URL, () => getToken()), [getToken])
}
