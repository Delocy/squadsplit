import { MAX_GROUP_MEMBERS, sameAvatar, type AvatarChoice, type GroupDTO, type MemberDTO, type UpdateMemberInput } from '@squadsplit/shared'
import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useParams } from 'react-router'
import { useApi } from '../api'
import { AvatarPicker, YouPreview } from '../components/AvatarPicker'
import { ConfirmBar, useConfirmStep } from '../components/ConfirmBar'
import { ErrorNote } from '../components/ErrorNote'
import { GroupLink } from '../components/GroupLink'
import { GroupUnavailable } from '../components/GroupUnavailable'
import { InviteCard } from '../components/InviteCard'
import { MemberList } from '../components/MemberList'
import { NICKNAME_HINT, NicknameField, useNicknameDraft } from '../components/NicknameField'
import { usePageNavigate } from '../components/PageLink'
import { SettingsSkeleton } from '../components/Skeletons'
import { BusyLabel } from '../design/Busy'
import { UiIcon } from '../design/icons'
import { peopleOf, useGroup, useGroupMutation } from '../groupData'
import { membershipErrorText } from '../membershipErrors'
import { MEMBER_NAME_HINT, MEMBER_NAME_MAX, parseMemberName } from '../memberName'
import { invalidateGroup, queryKeys } from '../queryKeys'
import { useSingleFlightMutation } from '../singleFlight'
import { useMe } from '../useProfileRefresh'
import { useMyId } from '../guest/GroupAccess'

const MAX_NAME = 50

/** `/groups/:id/settings`: inviting friends, your name and look here, the member list, renaming (owner) and leaving (members). */
export function GroupSettings() {
  const id = useParams().id ?? ''
  const me = useMyId()
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
        {isOwner && <AddNameCard group={g} />}
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
            <BusyLabel busy={save.isPending} label="Saving…">
              Save
            </BusyLabel>
          </button>
        </div>
      </form>
      {save.isError && <ErrorNote error={save.error} />}
    </section>
  )
}

/** The owner adds someone who hasn't joined yet, by name. They can claim it when they join. */
function AddNameCard({ group }: { group: GroupDTO }) {
  const api = useApi()
  const [name, setName] = useState('')
  const [invalid, setInvalid] = useState(false)
  const add = useGroupMutation(group.id, (newName: string) => api.post<MemberDTO>(`/groups/${group.id}/placeholders`, { name: newName }))
  const full = group.members.filter((m) => m.active).length >= MAX_GROUP_MEMBERS

  function submit(e: FormEvent) {
    e.preventDefault()
    const parsed = parseMemberName(name)
    setInvalid(parsed === null)
    if (parsed === null) return
    add.mutate(parsed, { onSuccess: () => setName('') })
  }

  return (
    <section className="card" aria-labelledby="add-name-h">
      <h3 id="add-name-h">
        <UiIcon name="plus" />
        Add a name
      </h3>
      <p className="s">For someone who hasn't joined yet. You can split with them now, and they can claim the name when they join.</p>
      <form className="invite-link" onSubmit={submit} noValidate>
        <input
          type="text"
          aria-label="Name"
          value={name}
          maxLength={MEMBER_NAME_MAX}
          disabled={full}
          onChange={(e) => {
            setName(e.target.value)
            setInvalid(false)
          }}
        />
        <button className="btn" type="submit" disabled={full || add.isPending || !name.trim()}>
          <BusyLabel busy={add.isPending} label="Adding…">
            Add
          </BusyLabel>
        </button>
      </form>
      {full && <p className="s">The group is full ({MAX_GROUP_MEMBERS} people).</p>}
      {invalid && (
        <p className="err" role="alert">
          {MEMBER_NAME_HINT}
        </p>
      )}
      {add.isError && <ErrorNote error={add.error} />}
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
          <BusyLabel busy={rename.isPending} label="Saving…">
            Save name
          </BusyLabel>
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
  const confirm = useConfirmStep()
  // Not useGroupMutation: refetching this group after leaving would 404 before we navigate away.
  const leave = useSingleFlightMutation({
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
      {confirm.showBar ? (
        <ConfirmBar
          question={`Leave ${group.name}?`}
          yes="Yes, leave"
          busyLabel="Leaving…"
          busy={leave.isPending}
          leaving={confirm.leaving}
          onYes={() => leave.mutate(undefined, { onError: confirm.close })}
          onCancel={confirm.close}
        />
      ) : (
        <button ref={confirm.triggerRef} className="btn danger" onClick={confirm.open}>
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
