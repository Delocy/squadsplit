import { SignInButton, useAuth } from '@clerk/react'
import {
  defaultAvatar,
  firstFreeAvatar,
  INVITE_CODE_LENGTH,
  MAX_GROUP_MEMBERS,
  sameAvatar,
  type AvatarChoice,
  type GuestJoinDTO,
  type GuestJoinInput,
  type InvitePreviewDTO,
  type JoinGroupInput,
  type PlaceholderDTO,
} from '@squadsplit/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { useLocation, useParams } from 'react-router'
import { ApiError, useApi } from '../api'
import { AvatarPicker, YouPreview } from '../components/AvatarPicker'
import { ErrorCard } from '../components/ErrorCard'
import { ErrorNote } from '../components/ErrorNote'
import { GroupLink } from '../components/GroupLink'
import { spacedCode } from '../components/InviteCard'
import { JoinWithCode } from '../components/JoinWithCode'
import { NICKNAME_HINT, NicknameField, useNicknameDraft } from '../components/NicknameField'
import { PageLink, usePageNavigate } from '../components/PageLink'
import { JoinSkeleton } from '../components/Skeletons'
import { Avatar, lookOf } from '../design/Avatar'
import { BusyLabel } from '../design/Busy'
import { Mascot } from '../design/icons'
import { clearSignedOutNotice, saveGuestPass, useGuestPass } from '../guest/guestPass'
import { MEMBER_NAME_HINT, MEMBER_NAME_MAX, parseMemberName } from '../memberName'
import { queryKeys } from '../queryKeys'
import { useSingleFlightMutation } from '../singleFlight'
import { useMe } from '../useProfileRefresh'

/** Who you are joining as: someone new, or one of the names the group already has for people who haven't joined. */
type Who = { kind: 'new' } | { kind: 'claim'; placeholder: PlaceholderDTO }

const isCode = (error: unknown, code: string) => error instanceof ApiError && error.code === code

/** What the form sends: a signed-in join, or a guest's (which also carries the name of someone new). */
type JoinInput = JoinGroupInput & { name?: string }

export function Join() {
  const code = useParams().code ?? ''
  // Typed into "Got a code?" (see JoinWithCode), rather than opened as a link.
  const typed = (useLocation().state as { typed?: boolean } | null)?.typed === true
  const path = `/invites/${encodeURIComponent(code)}`
  const api = useApi()
  const navigate = usePageNavigate()
  const queryClient = useQueryClient()
  // Signed out, you join as a guest: no account, and this phone remembers you.
  const asGuest = !useAuth().isSignedIn
  /** Your answer to "Which one are you?"; null until you answer (or when there is nothing to ask). */
  const [answer, setAnswer] = useState<Who | null>(null)

  const invite = useQuery({ queryKey: queryKeys.invite(code), queryFn: () => api.get<InvitePreviewDTO>(path) })
  const onThisPhone = useGuestPass(invite.data?.groupId ?? '')
  const join = useSingleFlightMutation({
    mutationFn: async (input: JoinInput): Promise<{ groupId: string }> => {
      if (!asGuest) return api.post<{ groupId: string }>(`${path}/join`, input)
      const joined = await api.post<GuestJoinDTO>(`${path}/guest`, input satisfies GuestJoinInput)
      saveGuestPass(joined.groupId, { token: joined.token, userId: joined.member.userId, groupName: invite.data?.name ?? '', code })
      return joined
    },
    onSuccess: ({ groupId }) => {
      clearSignedOutNotice(groupId)
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
    if (!dead) {
      return (
        <main className="narrow page">
          <ErrorCard error={invite.error} onRetry={() => void invite.refetch()} />
        </main>
      )
    }
    const upper = code.toUpperCase()
    return (
      <main className="narrow page">
        <section className="card join">
          <div className="hero-mark shiver">
            <Mascot kind="kitty" face="#ffe8a3" mood="nervous" />
          </div>
          {/* Everyone in a group can share its link, so anyone there can help. */}
          <p>
            {typed
              ? `We couldn't find a group with code ${upper.length === INVITE_CODE_LENGTH ? spacedCode(upper) : upper}. Check it, or ask anyone in the group to send you the invite link.`
              : "This invite link doesn't work any more. It may have been reset: ask anyone in the group to send you the new one."}
          </p>
          <JoinWithCode placeholder="Paste a link or code" />
          <BackLink asGuest={asGuest} />
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
  if (g.alreadyMember || (asGuest && onThisPhone)) {
    body = (
      <>
        <p>{g.alreadyMember ? "You're already in this group." : "You're in this group on this phone."}</p>
        <GroupLink groupId={g.groupId} className="btn primary">
          Open group
        </GroupLink>
      </>
    )
  } else if (full && names.length === 0) {
    body = (
      <>
        <p>This group is full ({MAX_GROUP_MEMBERS} people), so there's no room to join right now.</p>
        <BackLink asGuest={asGuest} />
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
            asGuest={asGuest}
            busy={join.isPending}
            onJoin={(input) => join.mutate(input)}
          />
        )}
        <ErrorNote error={join.error} />
        {asGuest && <SignInInstead />}
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

/**
 * Your nickname and look in the group, then Join. Claiming a name starts from its name and look. A guest who is new
 * gives their name first.
 */
function JoinForm({
  invite: g,
  who,
  asGuest,
  busy,
  onJoin,
}: {
  invite: InvitePreviewDTO
  who: Who
  asGuest: boolean
  busy: boolean
  onJoin: (input: JoinInput) => void
}) {
  const me = useAuth().userId ?? ''
  const profile = useMe().data
  const claimed = who.kind === 'claim' ? who.placeholder : null
  const newGuest = asGuest && !claimed
  const [name, setName] = useState('')
  const nameField = useRef<HTMLInputElement>(null)
  const profileName = newGuest ? name.trim() : (profile?.displayName ?? '')
  const nickname = useNicknameDraft(claimed?.name ?? (newGuest ? '' : profileName))
  /** The look you picked; null until you pick one. */
  const [choice, setChoice] = useState<AvatarChoice | null>(null)
  const [showHint, setShowHint] = useState<'name' | 'nickname' | null>(null)

  // A name you claim gives up its look to you, so it isn't taken from you.
  const taken = claimed ? withoutOne(g.takenAvatars, claimed.avatar) : g.takenAvatars
  // What the server gives you if you don't pick: the name's look when you claim one; otherwise the look you left
  // with (if you're rejoining), else your profile look, moved on to the first free look if someone has it. A new
  // guest has no look yet, so they start on one from the group and always send what they see.
  const start = newGuest ? defaultAvatar(`gs_${g.groupId}`) : (g.myFormerAvatar ?? profile?.profileAvatar ?? defaultAvatar(me))
  const given = claimed?.avatar ?? firstFreeAvatar(start, taken)
  // Your pick while it's free; if someone took it, the first free look from it; with no pick, what you're given.
  const avatar = choice ? firstFreeAvatar(choice, taken) : given

  function submit(e: FormEvent) {
    e.preventDefault()
    const newName = newGuest ? parseMemberName(name) : null
    const hint = newGuest && newName === null ? 'name' : nickname.invalid ? 'nickname' : null
    setShowHint(hint)
    // Back to the field the hint is about.
    if (hint === 'name') nameField.current?.focus()
    if (hint) return
    // The avatar only goes when it differs from what you're given, so the server's rule applies.
    onJoin({
      ...(claimed && { claim: claimed.userId }),
      ...(newName !== null && { name: newName }),
      ...((newGuest || !sameAvatar(avatar, given)) && { avatar }),
      ...(nickname.change !== undefined && { nickname: nickname.change }),
    })
  }

  return (
    <form className="you-fields" onSubmit={submit} noValidate>
      {newGuest && (
        <>
          <label className="f" htmlFor="join-name">
            Your name
          </label>
          <input
            ref={nameField}
            id="join-name"
            type="text"
            aria-invalid={showHint === 'name'}
            aria-describedby={showHint === 'name' ? 'join-hint' : undefined}
            maxLength={MEMBER_NAME_MAX}
            autoComplete="given-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setShowHint(null)
            }}
          />
        </>
      )}
      <NicknameField id="join-nickname" value={nickname.value} placeholder={profileName} onChange={nickname.setValue} />
      <span className="f">Your animal in this group</span>
      <YouPreview avatar={avatar} name={nickname.value.trim() || profileName} />
      <AvatarPicker value={avatar} taken={taken} onChange={setChoice} />
      {showHint && (
        <p className="err" role="alert" id="join-hint">
          {showHint === 'nickname' ? NICKNAME_HINT : name.trim() ? MEMBER_NAME_HINT : 'Enter your name.'}
        </p>
      )}
      <button className="btn primary" type="submit" disabled={busy}>
        <BusyLabel busy={busy} label="Joining…">
          {asGuest ? 'Join as guest' : 'Join group'}
        </BusyLabel>
      </button>
    </form>
  )
}

/** Under a guest's join form: join with an account instead, so the group shows in your list on every device. */
function SignInInstead() {
  const { pathname, search } = useLocation()
  const here = `${window.location.origin}${pathname}${search}`
  return (
    <div className="guest-note">
      <p className="s">No account needed. This phone remembers you.</p>
      <SignInButton mode="modal" forceRedirectUrl={here} signUpForceRedirectUrl={here}>
        <button type="button" className="btn ghost">
          Sign in to keep it in your list
        </button>
      </SignInButton>
    </div>
  )
}

/** Away from an invite that can't be joined: your groups, or the home page for a guest. */
function BackLink({ asGuest }: { asGuest: boolean }) {
  return (
    <PageLink to={asGuest ? '/' : '/groups'} className="btn small">
      {asGuest ? 'Home' : 'Back to your groups'}
    </PageLink>
  )
}

/** `looks` without the first one that matches `look`. */
function withoutOne(looks: AvatarChoice[], look: AvatarChoice): AvatarChoice[] {
  const i = looks.findIndex((l) => sameAvatar(l, look))
  return i < 0 ? looks : [...looks.slice(0, i), ...looks.slice(i + 1)]
}
