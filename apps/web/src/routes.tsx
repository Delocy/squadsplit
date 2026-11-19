import { Show } from '@clerk/react'
import { Navigate, Outlet, ScrollRestoration, type RouteObject } from 'react-router'
import { RequireSignIn } from './components/RequireSignIn'
import { TopBar } from './components/TopBar'
import { GroupLayout } from './guest/GroupLayout'
import { CreateGroup } from './pages/CreateGroup'
import { ExpenseForm } from './pages/ExpenseForm'
import { GroupHome } from './pages/GroupHome'
import { GroupSettings } from './pages/GroupSettings'
import { InviteSheet } from './pages/InviteSheet'
import { Groups } from './pages/Groups'
import { Join } from './pages/Join'
import { Landing } from './pages/Landing'
import { Profile } from './pages/Profile'
import { Wheel } from './pages/Wheel'
import { EditQuickSplit, NewQuickSplit } from './quick/QuickSplitFlow'
import { QuickSplitPage } from './quick/QuickSplitPage'
import { SharedSplitPage } from './quick/SharedSplitPage'
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

/**
 * Around the app's pages (all but the landing page and share links): the signed-in user's profile is refreshed once
 * after sign-in. It stays mounted while moving between them, so that happens once.
 */
function ProfileRefresh() {
  useProfileRefresh()
  return <Outlet />
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

/** Pages that work signed in or out (an invite: you can join it as a guest). */
function OpenLayout() {
  return (
    <div className="wrap">
      <TopBar />
      <Outlet />
    </div>
  )
}

/**
 * Around every page: new pages start at the top, and Back returns to where you were. Opening or closing the expense
 * dialog keeps the group where it is (its links pass `preventScrollReset`).
 */
function AppShell() {
  return (
    <>
      <Outlet />
      <ScrollRestoration />
    </>
  )
}

/** Pages anyone may open with no account: they never use Clerk (see isPublicPath in Root.tsx). */
export const PUBLIC_PATH = /^\/s\/[^/]+\/?$/

const pages: RouteObject[] = [
  { path: '/', element: <Home /> },
  // A quick split's share link: outside the signed-in pages, for friends with no account.
  { path: '/s/:token', element: <SharedSplitPage /> },
  {
    element: <ProfileRefresh />,
    children: [
      // An invite, for friends with or without an account.
      { element: <OpenLayout />, children: [{ path: '/join/:code', element: <Join /> }] },
      // A group's pages, for its signed-in members and for guests holding this phone's pass for it.
      {
        path: '/groups/:id',
        element: <GroupLayout />,
        children: [
          {
            element: <GroupHome />,
            // The add/edit expense dialog and the invite sheet open over the group home.
            children: [
              { index: true, element: null },
              { path: 'invite', element: <InviteSheet /> },
              { path: 'expenses/new', element: <ExpenseForm /> },
              { path: 'expenses/:expenseId', element: <ExpenseForm /> },
            ],
          },
          { path: 'wheel', element: <Wheel /> },
          { path: 'settings', element: <GroupSettings /> },
        ],
      },
      {
        element: <SignedInLayout />,
        children: [
          { path: '/groups', element: <Groups /> },
          { path: '/groups/new', element: <CreateGroup /> },
          { path: '/me', element: <Profile /> },
          // Quick splits name their id `splitId`: the top bar reads `id` as a group's.
          { path: '/quick/new', element: <NewQuickSplit /> },
          { path: '/quick/:splitId', element: <QuickSplitPage /> },
          { path: '/quick/:splitId/edit', element: <EditQuickSplit /> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]

export const routes: RouteObject[] = [{ element: <AppShell />, children: pages }]
