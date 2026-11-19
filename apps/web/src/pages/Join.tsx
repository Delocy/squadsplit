import type { InvitePreviewDTO } from '@squadsplit/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CSSProperties } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ApiError, useApi } from '../api'
import { ErrorNote } from '../components/ErrorNote'
import { avatarFor } from '../design/Avatar'
import { Mascot } from '../design/icons'
import { queryKeys } from '../queryKeys'

export function Join() {
  const code = useParams().code ?? ''
  const path = `/invites/${encodeURIComponent(code)}`
  const api = useApi()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const invite = useQuery({ queryKey: queryKeys.invite(code), queryFn: () => api.get<InvitePreviewDTO>(path) })
  const join = useMutation({
    mutationFn: () => api.post<{ groupId: string }>(`${path}/join`),
    onSuccess: ({ groupId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.groups })
      navigate(`/groups/${groupId}`, { replace: true })
    },
  })

  if (invite.isPending) {
    return (
      <main className="narrow page">
        <p className="empty">Checking the invite…</p>
      </main>
    )
  }

  if (invite.isError) {
    const dead = invite.error instanceof ApiError && invite.error.status === 404
    return (
      <main className="narrow page">
        <section className="card join">
          <div className="hero-mark shiver">
            <Mascot kind="kitty" face="#ffe8a3" mood="nervous" />
          </div>
          {dead ? (
            <p>This invite link doesn't work any more. Ask a friend in the group for a new one.</p>
          ) : (
            <ErrorNote error={invite.error} />
          )}
          <Link to="/groups" className="btn small">
            Back to your groups
          </Link>
        </section>
      </main>
    )
  }

  const g = invite.data
  const look = avatarFor(g.groupId)
  return (
    <main className="narrow page">
      <section className="card join">
        <div className="hero-mark bob" style={{ background: look.bg } as CSSProperties}>
          <Mascot kind={look.kind} face={look.face} mood="happy" />
        </div>
        <p className="lbl">You're invited to</p>
        <h2>{g.name}</h2>
        <p className="empty">{g.memberCount === 1 ? '1 member' : `${g.memberCount} members`}</p>
        {g.alreadyMember ? (
          <>
            <p>You're already in this group.</p>
            <Link to={`/groups/${g.groupId}`} className="btn primary">
              Open group
            </Link>
          </>
        ) : (
          <>
            <button className="btn primary" onClick={() => join.mutate()} disabled={join.isPending}>
              {join.isPending ? 'Joining…' : 'Join group'}
            </button>
            <ErrorNote error={join.error} />
          </>
        )}
      </section>
    </main>
  )
}
