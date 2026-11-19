import { useAuth } from '@clerk/react'
import type { GroupSummaryDTO, InvitePreviewDTO } from '@squadsplit/shared'
import { useQuery } from '@tanstack/react-query'
import { Outlet, useLocation, useParams } from 'react-router'
import { ApiError, useApi } from '../api'
import { JoinWithCode } from '../components/JoinWithCode'
import { PageLink } from '../components/PageLink'
import { RequireSignIn } from '../components/RequireSignIn'
import { GroupHomeSkeleton, SettingsSkeleton, WheelPageSkeleton } from '../components/Skeletons'
import { TopBar } from '../components/TopBar'
import { Mascot } from '../design/icons'
import { queryKeys } from '../queryKeys'
import { GroupAccessProvider, type GroupAccess } from './GroupAccess'
import { useGuestPass, useSignedOutNotice, type GuestPass } from './guestPass'

/**
 * Around every page inside a group (`/groups/:id/...`). A signed-in member sees it as now. With this phone's guest
 * pass for the group, it opens with no account, or for a signed-in account that isn't in the group itself (say,
 * just signed in to save the guest). Anyone else goes to sign-in, unless their guest pass was just turned down: then
 * they're told why.
 */
export function GroupLayout() {
  const groupId = useParams().id ?? ''
  const { pathname } = useLocation()
  const { isSignedIn } = useAuth()
  const guest = useGuestFor(groupId)
  const notice = useSignedOutNotice(groupId)

  // No top bar yet: it would read the group before we know which way to ask for it.
  if (guest === 'checking') return <div className="wrap">{skeletonFor(pathname)}</div>
  // Only for a phone nobody is signed in on and that has no working pass: an account reaches the group as itself.
  if (!guest && notice && !isSignedIn) {
    return (
      <div className="wrap">
        <TopBar />
        <SignedOutCard groupName={notice.groupName} code={notice.code} />
      </div>
    )
  }
  const access: GroupAccess = { groupId, guest }
  // Keyed by how the group is reached, so saving a guest to the account remounts the pages as the account's.
  const page = (
    <GroupAccessProvider key={guest ? 'guest' : 'account'} value={access}>
      <div className="wrap">
        <TopBar />
        <Outlet />
      </div>
    </GroupAccessProvider>
  )
  return guest ? page : <RequireSignIn>{page}</RequireSignIn>
}

/** The page's own loading skeleton, so it doesn't flash another page's while the pass is checked. */
function skeletonFor(pathname: string) {
  if (pathname.endsWith('/settings')) return <SettingsSkeleton />
  if (pathname.endsWith('/wheel')) return <WheelPageSkeleton />
  return <GroupHomeSkeleton />
}

/**
 * The guest pass to open the group with, or null to open it as the signed-in account. A signed-in phone that also
 * holds a pass uses it only when the account isn't in the group ('checking' while that is looked up).
 */
function useGuestFor(groupId: string): GuestPass | null | 'checking' {
  const { isSignedIn } = useAuth()
  const pass = useGuestPass(groupId)
  const api = useApi()
  const accountGroups = useQuery({
    queryKey: queryKeys.groups,
    queryFn: () => api.get<GroupSummaryDTO[]>('/groups'),
    enabled: Boolean(isSignedIn && pass),
  })
  if (!pass) return null
  if (!isSignedIn) return pass
  if (accountGroups.isPending) return 'checking'
  return accountGroups.data?.some((g) => g.id === groupId) ? null : pass
}

/**
 * The owner reset the link or freed up the name, so this phone's guest pass stopped working. Which one is told by
 * the old link: after "Free up name" it still works, so it offers Join again; after a reset it's dead, so it asks for
 * the new one (anyone in the group can send it) and takes it right here, never sending you back to the dead link.
 */
function SignedOutCard({ groupName, code }: { groupName: string; code: string }) {
  const api = useApi()
  const invite = useQuery({ queryKey: queryKeys.invite(code), queryFn: () => api.get<InvitePreviewDTO>(`/invites/${encodeURIComponent(code)}`) })
  const dead = invite.error instanceof ApiError && invite.error.status === 404
  return (
    <main className="narrow page">
      <section className="card join" role="alert">
        <div className="hero-mark shiver">
          <Mascot kind="bunny" face="#ffd6e0" mood="nervous" />
        </div>
        <p>You've been signed out of {groupName}.</p>
        {invite.isSuccess && (
          <>
            <p className="s">Your name is free to claim again with the same link.</p>
            <PageLink to={`/join/${code}`} className="btn primary">
              Join again
            </PageLink>
          </>
        )}
        {dead && (
          <>
            <p className="s">There's a new invite link for {groupName}. Ask anyone in the group to send it to you.</p>
            <JoinWithCode placeholder="Paste the new link" />
          </>
        )}
        {invite.isError && !dead && (
          <button type="button" className="btn primary" onClick={() => void invite.refetch()}>
            Try again
          </button>
        )}
      </section>
    </main>
  )
}
