import { useAuth } from '@clerk/react'
import {
  defaultAvatar,
  firstFreeAvatar,
  MAX_GROUP_MEMBERS,
  sameAvatar,
  type AvatarChoice,
  type InvitePreviewDTO,
  type JoinGroupInput,
  type PlaceholderDTO,
} from '@squadsplit/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type CSSProperties, type FormEvent } from 'react'
import { useParams } from 'react-router'
import { ApiError, useApi } from '../api'
import { AvatarPicker, YouPreview } from '../components/AvatarPicker'
import { ErrorNote } from '../components/ErrorNote'
import { GroupLink } from '../components/GroupLink'
import { NICKNAME_HINT, NicknameField, useNicknameDraft } from '../components/NicknameField'
import { PageLink, usePageNavigate } from '../components/PageLink'
import { JoinSkeleton } from '../components/Skeletons'
import { Avatar, lookOf } from '../design/Avatar'
import { BusyLabel } from '../design/Busy'
import { Mascot } from '../design/icons'
import { queryKeys } from '../queryKeys'
import { useSingleFlightMutation } from '../singleFlight'
import { useMe } from '../useProfileRefresh'

/** Who you are joining as: someone new, or one of the names the group already has for people who haven't joined. */
type Who = { kind: 'new' } | { kind: 'claim'; placeholder: PlaceholderDTO }

const isCode = (error: unknown, code: string) => error instanceof ApiError && error.code === code

export function Join() {
  const code = useParams().code ?? ''
  const path = `/invites/${encodeURIComponent(code)}`
  const api = useApi()
  const navigate = usePageNavigate()
  const queryClient = useQueryClient()
  /** Your answer to "Which one are you?"; null until you answer (or when there is nothing to ask). */
  const [answer, setAnswer] = useState<Who | null>(null)

  const invite = useQuery({ queryKey: queryKeys.invite(code), queryFn: () => api.get<InvitePreviewDTO>(path) })
  const join = useSingleFlightMutation({
    mutationFn: (input: JoinGroupInput) => api.post<{ groupId: string }>(`${path}/join`, input),
    onSuccess: ({ groupId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.groups })
      navigate(`/groups/${groupId}`, { replace: true })
    },
    onError: (error) => {
      // Someone took that look, or that name, in the meantime: refetch who has what. A name that went asks again.
      if (isCode(error, 'avatar_taken') || isCode(error, 'already_claimed')) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.invite(code) })
      }
      if (isCode(error, 'already_claimed')) setAnswer(null)
    },
  })

  if (invite.isPending) return <JoinSkeleton />

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
  // A former member rejoins as themselves, so only newcomers are asked which name is theirs.
  const names = g.myFormerAvatar ? [] : g.placeholders
  // Full from the preview, or it filled up between the preview and pressing Join. Claiming a name takes no new place.
  const full = g.memberCount >= MAX_GROUP_MEMBERS || isCode(join.error, 'group_full')
  const who: Who | null = answer ?? (names.length === 0 ? { kind: 'new' } : null)

  let body
  if (g.alreadyMember) {
    body = (
      <>
        <p>You're already in this group.</p>
        <GroupLink groupId={g.groupId} className="btn primary">
          Open group
        </GroupLink>
      </>
    )
  } else if (full && names.length === 0) {
    body = (
      <>
        <p>This group is full ({MAX_GROUP_MEMBERS} people), so there's no room to join right now.</p>
        <PageLink to="/groups" className="btn small">
          Back to your groups
        </PageLink>
      </>
    )
  } else {
    const answered = who && !(who.kind === 'new' && full)
    body = (
      <>
        {names.length > 0 && (
          <WhichOneAreYou
            names={names}
            offerNew={!full}
            who={answered ? who : null}
            onAnswer={(next) => {
              join.reset()
              setAnswer(next)
            }}
          />
        )}
        {answered && (
          <JoinForm
            key={who.kind === 'claim' ? who.placeholder.userId : 'new'}
            invite={g}
            who={who}
            busy={join.isPending}
            onJoin={(input) => join.mutate(input)}
          />
        )}
        <ErrorNote error={join.error} />
      </>
    )
  }

  return (
    <main className="narrow page">
      <section className="card join">
        <div className="hero-mark bob" style={{ background: look.bg } as CSSProperties}>
          <Mascot kind={look.kind} face={look.face} mood="happy" />
        </div>
        <p className="lbl">You're invited to</p>
        <h2>{g.name}</h2>
        <p className="empty">{g.memberCount === 1 ? '1 member' : `${g.memberCount} members`}</p>
        {body}
      </section>
    </main>
  )
}

/** The names the owner added for people who haven't joined, and "I'm new" (unless the group is full). */
function WhichOneAreYou({
  names,
  offerNew,
  who,
  onAnswer,
}: {
  names: PlaceholderDTO[]
  offerNew: boolean
  who: Who | null
  onAnswer: (who: Who) => void
}) {
  return (
    <div className="who-are-you">
      <span className="f" id="who-are-you-h">
        Which one are you?
      </span>
      <div className="who-list" role="group" aria-labelledby="who-are-you-h">
        {names.map((p) => (
          <button
            key={p.userId}
            type="button"
            className="pick who-pick"
            aria-pressed={who?.kind === 'claim' && who.placeholder.userId === p.userId}
            onClick={() => onAnswer({ kind: 'claim', placeholder: p })}
          >
            <Avatar avatar={p.avatar} />
            <span>{p.name}</span>
          </button>
        ))}
        {offerNew && (
          <button
            type="button"
            className="pick who-pick new"
            aria-pressed={who?.kind === 'new'}
            onClick={() => onAnswer({ kind: 'new' })}
          >
            <span>I'm new</span>
          </button>
        )}
      </div>
    </div>
  )
}

/** Your nickname and look in the group, then Join. Claiming a name starts from its name and look. */
function JoinForm({
  invite: g,
  who,
  busy,
  onJoin,
}: {
  invite: InvitePreviewDTO
  who: Who
  busy: boolean
  onJoin: (input: JoinGroupInput) => void
}) {
  const me = useAuth().userId ?? ''
  const profile = useMe().data
  const profileName = profile?.displayName ?? ''
  const claimed = who.kind === 'claim' ? who.placeholder : null
  const nickname = useNicknameDraft(claimed?.name ?? profileName)
  /** The look you picked; null until you pick one. */
  const [choice, setChoice] = useState<AvatarChoice | null>(null)
  const [showHint, setShowHint] = useState(false)

  // A name you claim gives up its look to you, so it isn't taken from you.
  const taken = claimed ? withoutOne(g.takenAvatars, claimed.avatar) : g.takenAvatars
  // What the server gives you if you don't pick: the name's look when you claim one; otherwise the look you left
  // with (if you're rejoining), else your profile look, moved on to the first free look if someone has it.
  const given = claimed?.avatar ?? firstFreeAvatar(g.myFormerAvatar ?? profile?.profileAvatar ?? defaultAvatar(me), taken)
  // Your pick while it's free; if someone took it, the first free look from it; with no pick, what you're given.
  const avatar = choice ? firstFreeAvatar(choice, taken) : given

  function submit(e: FormEvent) {
    e.preventDefault()
    setShowHint(nickname.invalid)
    if (nickname.invalid) return
    // The avatar only goes when it differs from what you're given, so the server's rule applies.
    onJoin({
      ...(claimed && { claim: claimed.userId }),
      ...(!sameAvatar(avatar, given) && { avatar }),
      ...(nickname.change !== undefined && { nickname: nickname.change }),
    })
  }

  return (
    <form className="you-fields" onSubmit={submit} noValidate>
      <NicknameField id="join-nickname" value={nickname.value} placeholder={profileName} onChange={nickname.setValue} />
      <span className="f">Your animal in this group</span>
      <YouPreview avatar={avatar} name={nickname.value.trim() || profileName} />
      <AvatarPicker value={avatar} taken={taken} onChange={setChoice} />
      {showHint && nickname.invalid && (
        <p className="err" role="alert">
          {NICKNAME_HINT}
        </p>
      )}
      <button className="btn primary" type="submit" disabled={busy}>
        <BusyLabel busy={busy} label="Joining…">
          Join group
        </BusyLabel>
      </button>
    </form>
  )
}

/** `looks` without the first one that matches `look`. */
function withoutOne(looks: AvatarChoice[], look: AvatarChoice): AvatarChoice[] {
  const i = looks.findIndex((l) => sameAvatar(l, look))
  return i < 0 ? looks : [...looks.slice(0, i), ...looks.slice(i + 1)]
}
