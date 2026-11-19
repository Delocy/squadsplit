import { Show } from '@clerk/react'
import { Navigate, Outlet, type RouteObject } from 'react-router'
import { RequireSignIn } from './components/RequireSignIn'
import { TopBar } from './components/TopBar'
import { CreateGroup } from './pages/CreateGroup'
import { GroupPlaceholder } from './pages/GroupPlaceholder'
import { Groups } from './pages/Groups'
import { Join } from './pages/Join'
import { Landing } from './pages/Landing'

/** `/`: the landing page when signed out, your groups when signed in. */
function Home() {
  return (
    <>
      <Show when="signed-out">
        <Landing />
      </Show>
      <Show when="signed-in">
        <Navigate to="/groups" replace />
      </Show>
    </>
  )
}

/** Every page behind sign-in gets the top bar. */
function SignedInLayout() {
  return (
    <RequireSignIn>
      <div className="wrap">
        <TopBar />
        <Outlet />
      </div>
    </RequireSignIn>
  )
}

export const routes: RouteObject[] = [
  { path: '/', element: <Home /> },
  {
    element: <SignedInLayout />,
    children: [
      { path: '/groups', element: <Groups /> },
      { path: '/groups/new', element: <CreateGroup /> },
      { path: '/join/:code', element: <Join /> },
      { path: '/groups/:id', element: <GroupPlaceholder /> },
      { path: '/groups/:id/expenses/new', element: <GroupPlaceholder /> },
      { path: '/groups/:id/expenses/:expenseId', element: <GroupPlaceholder /> },
      { path: '/groups/:id/wheel', element: <GroupPlaceholder /> },
      { path: '/groups/:id/settings', element: <GroupPlaceholder /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]
