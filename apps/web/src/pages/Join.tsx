import { useAuth } from '@clerk/react'
import {
  defaultAvatar,
  firstFreeAvatar,
  MAX_GROUP_MEMBERS,
  sameAvatar,
  type AvatarChoice,
  type InvitePreviewDTO,
  type JoinGroupInput,
} from '@squadsplit/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type CSSProperties, type FormEvent } from 'react'
import { useParams } from 'react-router'
import { ApiError, useApi } from '../api'
import { AvatarPicker, YouPreview } from '../components/AvatarPicker'
import { ErrorNote } from '../components/ErrorNote'
import { NICKNAME_HINT, NicknameField, useNicknameDraft } from '../components/NicknameField'
import { PageLink, usePageNavigate } from '../components/PageLink'
import { lookOf } from '../design/Avatar'
import { Mascot } from '../design/icons'
import { queryKeys } from '../queryKeys'
import { useMe } from '../useProfileRefresh'

export function Join() {
  const code = useParams().code ?? ''
  const path = `/invites/${encodeURIComponent(code)}`
  const api = useApi()
  const navigate = usePageNavigate()
  const queryClient = useQueryClient()
  const me = useAuth().userId ?? ''
  const profileName = useMe().data?.displayName ?? ''
  const nickname = useNicknameDraft(profileName)
  /** The look you picked; null until you pick one. */
  const [choice, setChoice] = useState<AvatarChoice | null>(null)
  const [showHint, setShowHint] = useState(false)

  const invite = useQuery({ queryKey: queryKeys.invite(code), queryFn: () => api.get<InvitePreviewDTO>(path) })
  const join = useMutation({
    mutationFn: (input: JoinGroupInput) => api.post<{ groupId: string }>(`${path}/join`, input),
    onSuccess: ({ groupId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.groups })
      navigate(`/groups/${groupId}`, { replace: true })
    },
    // Someone took that look in the meantime: refetch who has what, so the picker moves to a free one.
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'avatar_taken') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.invite(code) })
      }
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
          <PageLink to="/groups" className="btn small">
            Back to your groups
          </PageLink>
        </section>
      </main>
    )
  }

  const g = invite.data
  const look = lookOf(defaultAvatar(g.groupId))
  // What the server gives you if you don't pick: the look you left with (if you're rejoining), else your default,
  // moved on to the first free look if someone has it.
  const given = firstFreeAvatar(g.myFormerAvatar ?? defaultAvatar(me), g.takenAvatars)
  // Your pick while it's free; if someone took it, the first free look from it; with no pick, what you're given.
  const avatar = choice ? firstFreeAvatar(choice, g.takenAvatars) : given

  function submit(e: FormEvent) {
    e.preventDefault()
    setShowHint(nickname.invalid)
    if (nickname.invalid) return
    // The avatar only goes when it differs from what you're given, so the server's rule (old look first) applies.
    join.mutate({
      ...(!sameAvatar(avatar, given) && { avatar }),
      ...(nickname.change !== undefined && { nickname: nickname.change }),
    })
  }

  // Full from the preview, or it filled up between the preview and pressing Join.
  const full =
    g.memberCount >= MAX_GROUP_MEMBERS || (join.error instanceof ApiError && join.error.code === 'group_full')
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
            <PageLink to={`/groups/${g.groupId}`} className="btn primary">
              Open group
            </PageLink>
          </>
        ) : full ? (
          <>
            <p>This group is full ({MAX_GROUP_MEMBERS} people), so there's no room to join right now.</p>
            <PageLink to="/groups" className="btn small">
              Back to your groups
            </PageLink>
          </>
        ) : (
          <form className="you-fields" onSubmit={submit} noValidate>
            <NicknameField id="join-nickname" value={nickname.value} placeholder={profileName} onChange={nickname.setValue} />
            <span className="f">Your animal in this group</span>
            <YouPreview avatar={avatar} name={nickname.value.trim() || profileName} />
            <AvatarPicker value={avatar} taken={g.takenAvatars} onChange={setChoice} />
            {showHint && nickname.invalid && (
              <p className="err" role="alert">
                {NICKNAME_HINT}
              </p>
            )}
            <button className="btn primary" type="submit" disabled={join.isPending}>
              {join.isPending ? 'Joining…' : 'Join group'}
            </button>
            <ErrorNote error={join.error} />
          </form>
        )}
      </section>
    </main>
  )
}
