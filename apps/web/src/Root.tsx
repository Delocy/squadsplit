import { ClerkFailed, ClerkLoaded, ClerkLoading, ClerkProvider } from '@clerk/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { createBrowserRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { isRetryable } from './api'
import { LogoPup } from './components/Logo'
import { Setup } from './pages/Setup'
import { PUBLIC_PATH, routes } from './routes'

/** The whole app. Without a Clerk key it shows setup steps instead, so it can be previewed before Clerk exists. */
export function Root({ publishableKey }: { publishableKey: string | undefined }) {
  // A share link opened by a friend with no account: it must work even if Clerk never loads, so Clerk isn't started.
  if (PUBLIC_PATH.test(window.location.pathname)) return <PublicApp />
  if (!publishableKey) return <Setup />
  return <App publishableKey={publishableKey} />
}

const newQueryClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: (count, error) => count < 2 && isRetryable(error) } },
  })

/** The public pages alone, with no ClerkProvider. Their links back into the app reload the page, which starts Clerk. */
function PublicApp() {
  const [queryClient] = useState(newQueryClient)
  const [router] = useState(() => createBrowserRouter(routes))
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

function App({ publishableKey }: { publishableKey: string }) {
  const [queryClient] = useState(newQueryClient)
  const [router] = useState(() => createBrowserRouter(routes))
  return (
    <ClerkProvider publishableKey={publishableKey} afterSignOutUrl="/">
      <QueryClientProvider client={queryClient}>
        <ClerkLoading>
          <LoadingScreen />
        </ClerkLoading>
        <ClerkFailed>
          <ClerkFailedScreen />
        </ClerkFailed>
        <ClerkLoaded>
          <RouterProvider router={router} />
        </ClerkLoaded>
      </QueryClientProvider>
    </ClerkProvider>
  )
}

/** Shown for the moment Clerk takes to load, instead of a blank page. */
function LoadingScreen() {
  return (
    <main className="wrap narrow landing" role="status" aria-label="Loading SquadSplit">
      <div className="hero-mark bob">
        <LogoPup />
      </div>
    </main>
  )
}

/** Shown when Clerk's script can't load (offline, blocked), instead of a page that never leaves the loading state. */
function ClerkFailedScreen() {
  return (
    <main className="wrap narrow landing">
      <section className="card join" role="alert">
        <div className="hero-mark shiver">
          <LogoPup mood="nervous" />
        </div>
        <p>Can't reach sign-in. Check your connection and try again.</p>
        <button className="btn primary" onClick={() => window.location.reload()}>
          Try again
        </button>
      </section>
    </main>
  )
}
