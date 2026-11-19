import { Show } from '@clerk/react'
import { Navigate, Outlet, type RouteObject } from 'react-router'
import { RequireSignIn } from './components/RequireSignIn'
import { TopBar } from './components/TopBar'
import { CreateGroup } from './pages/CreateGroup'
import { ExpenseForm } from './pages/ExpenseForm'
import { GroupHome } from './pages/GroupHome'
import { GroupSettings } from './pages/GroupSettings'
import { Groups } from './pages/Groups'
import { Join } from './pages/Join'
import { Landing } from './pages/Landing'
import { Wheel } from './pages/Wheel'
import { useProfileRefresh } from './useProfileRefresh'

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

/** Every page behind sign-in gets the top bar, and the user's profile is refreshed once after sign-in. */
function SignedInLayout() {
  useProfileRefresh()
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
      {
        path: '/groups/:id',
        element: <GroupHome />,
        // The add/edit expense dialog opens over the group home.
        children: [
          { path: 'expenses/new', element: <ExpenseForm /> },
          { path: 'expenses/:expenseId', element: <ExpenseForm /> },
        ],
      },
      { path: '/groups/:id/wheel', element: <Wheel /> },
      { path: '/groups/:id/settings', element: <GroupSettings /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]
