import { useAuth } from '@clerk/react'
import { sameAvatar, type AvatarChoice, type GroupDTO, type MemberDTO, type UpdateMemberInput } from '@squadsplit/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useParams } from 'react-router'
import { useApi } from '../api'
import { AvatarPicker, YouPreview } from '../components/AvatarPicker'
import { ConfirmBar } from '../components/ConfirmBar'
import { ErrorNote } from '../components/ErrorNote'
import { GroupLink } from '../components/GroupLink'
import { GroupUnavailable } from '../components/GroupUnavailable'
import { InviteCard } from '../components/InviteCard'
import { MemberList } from '../components/MemberList'
import { NICKNAME_HINT, NicknameField, useNicknameDraft } from '../components/NicknameField'
import { usePageNavigate } from '../components/PageLink'
import { SettingsSkeleton } from '../components/Skeletons'
import { UiIcon } from '../design/icons'
import { peopleOf, useGroup, useGroupMutation } from '../groupData'
import { membershipErrorText } from '../membershipErrors'
import { invalidateGroup, queryKeys } from '../queryKeys'
import { useMe } from '../useProfileRefresh'

const MAX_NAME = 50

/** `/groups/:id/settings`: inviting friends, your name and look here, the member list, renaming (owner) and leaving (members). */
export function GroupSettings() {
  const id = useParams().id ?? ''
  const me = useAuth().userId ?? ''
  const group = useGroup(id)

  if (group.isPending) return <SettingsSkeleton />
  if (group.isError) return <GroupUnavailable error={group.error} />

  const g = group.data
  const isOwner = g.ownerId === me
  const mine = g.members.find((m) => m.userId === me && m.active)
  return (
    <main className="narrow page">
      <div className="page-h">
        <h2>Group settings</h2>
        <GroupLink groupId={id} className="btn small ghost">
          Back to the group
        </GroupLink>
      </div>
      <div className="col">
        {isOwner && g.inviteCode ? (
          <InviteCard groupId={id} inviteCode={g.inviteCode} />
        ) : (
          <section className="card" aria-labelledby="invite-h">
            <h3 id="invite-h">
              <UiIcon name="heart" />
              Invite friends
            </h3>
            <p className="s">Ask {peopleOf(g, me).name(g.ownerId)} for the invite link</p>
          </section>
        )}
        {mine && <YouCard group={g} mine={mine} />}
        {isOwner && <RenameCard group={g} />}
        <MemberList group={g} me={me} />
        {!isOwner && <LeaveCard group={g} me={me} />}
      </div>
    </main>
  )
}

/** Your nickname and animal in this group, saved together. */
function YouCard({ group, mine }: { group: GroupDTO; mine: MemberDTO }) {
  const api = useApi()
  const profileName = useMe().data?.displayName ?? ''
  const nickname = useNicknameDraft(mine.displayName)
  const [choice, setChoice] = useState<AvatarChoice | null>(null)
  const [showHint, setShowHint] = useState(false)
  const avatar = choice ?? mine.avatar
  const taken = group.members.filter((m) => m.active && m.userId !== mine.userId).map((m) => m.avatar)
  const save = useGroupMutation(group.id, (input: UpdateMemberInput) =>
    api.patch<MemberDTO>(`/groups/${group.id}/members/me`, input),
  )
  // Only what changed goes to the API.
  const changes: UpdateMemberInput = {
    ...(!sameAvatar(avatar, mine.avatar) && { avatar }),
    ...(nickname.change !== undefined && { nickname: nickname.change }),
  }
  const dirty = Object.keys(changes).length > 0

  function submit(e: FormEvent) {
    e.preventDefault()
    setShowHint(nickname.invalid)
    if (nickname.invalid) return
    save.mutate(changes, {
      onSuccess: () => {
        setChoice(null)
        nickname.reset()
      },
    })
  }

  return (
    <section className="card" aria-labelledby="you-h">
      <h3 id="you-h">
        <UiIcon name="star" />
        You in this group
      </h3>
      <form className="you-fields" onSubmit={submit} noValidate>
        <NicknameField id="you-nickname" value={nickname.value} placeholder={profileName} onChange={nickname.setValue} />
        <span className="f">Your animal in this group</span>
        <YouPreview avatar={avatar} name={nickname.value.trim() || profileName} />
        <AvatarPicker value={avatar} taken={taken} onChange={setChoice} />
        {showHint && nickname.invalid && (
          <p className="err" role="alert">
            {NICKNAME_HINT}
          </p>
        )}
        <div className="form-f">
          {save.isSuccess && !dirty && (
            <span className="s" role="status">
              Saved
            </span>
          )}
          <button className="btn primary" type="submit" disabled={save.isPending || !dirty}>
            Save
          </button>
        </div>
      </form>
      {save.isError && <ErrorNote error={save.error} />}
    </section>
  )
}

function RenameCard({ group }: { group: GroupDTO }) {
  const api = useApi()
  const [name, setName] = useState(group.name)
  const rename = useGroupMutation(group.id, (newName: string) => api.patch<GroupDTO>(`/groups/${group.id}`, { name: newName }))
  const trimmed = name.trim()

  function submit(e: FormEvent) {
    e.preventDefault()
    rename.mutate(trimmed)
  }

  return (
    <section className="card" aria-labelledby="rename-h">
      <h3 id="rename-h">
        <UiIcon name="sparkle" />
        Name
      </h3>
      <form className="invite-link" onSubmit={submit}>
        <input type="text" aria-label="Group name" value={name} maxLength={MAX_NAME} onChange={(e) => setName(e.target.value)} />
        <button className="btn" type="submit" disabled={rename.isPending || !trimmed || trimmed === group.name}>
          Save name
        </button>
      </form>
      {rename.isError && <ErrorNote error={rename.error} />}
    </section>
  )
}

function LeaveCard({ group, me }: { group: GroupDTO; me: string }) {
  const api = useApi()
  const navigate = usePageNavigate()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  // Not useGroupMutation: refetching this group after leaving would 404 before we navigate away.
  const leave = useMutation({
    mutationFn: () => api.del(`/groups/${group.id}/members/${me}`),
    onSuccess: () => {
      void navigate('/groups')
      void queryClient.invalidateQueries({ queryKey: queryKeys.groups })
    },
    onError: () => invalidateGroup(queryClient, group.id),
  })

  return (
    <section className="card" aria-labelledby="leave-h">
      <h3 id="leave-h">
        <UiIcon name="arrow" />
        Leave
      </h3>
      <p className="s">You can leave once you're settled up. You can come back later with an invite link.</p>
      {confirming ? (
        <ConfirmBar
          question={`Leave ${group.name}?`}
          yes="Yes, leave"
          busy={leave.isPending}
          onYes={() => leave.mutate(undefined, { onError: () => setConfirming(false) })}
          onCancel={() => setConfirming(false)}
        />
      ) : (
        <button className="btn danger" onClick={() => setConfirming(true)}>
          Leave group
        </button>
      )}
      {leave.isError && (
        <p className="err" role="alert">
          {membershipErrorText(leave.error, null)}
        </p>
      )}
    </section>
  )
}
