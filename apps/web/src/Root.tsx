import { ClerkLoaded, ClerkLoading, ClerkProvider } from '@clerk/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { ApiError } from './api'
import { Mascot } from './design/icons'
import { Setup } from './pages/Setup'
import { routes } from './routes'

/** The whole app. Without a Clerk key it shows setup steps instead, so it can be previewed before Clerk exists. */
export function Root({ publishableKey }: { publishableKey: string | undefined }) {
  if (!publishableKey) return <Setup />
  return <App publishableKey={publishableKey} />
}

function App({ publishableKey }: { publishableKey: string }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        // A 4xx (not a member, dead invite, validation) will not change on retry; network and 5xx errors might.
        defaultOptions: { queries: { retry: (count, error) => count < 2 && !(error instanceof ApiError && error.status < 500) } },
      }),
  )
  const [router] = useState(() => createBrowserRouter(routes))
  return (
    <ClerkProvider publishableKey={publishableKey} afterSignOutUrl="/">
      <QueryClientProvider client={queryClient}>
        <ClerkLoading>
          <LoadingScreen />
        </ClerkLoading>
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
        <Mascot kind="bunny" face="#ffffff" mood="happy" />
      </div>
    </main>
  )
}
