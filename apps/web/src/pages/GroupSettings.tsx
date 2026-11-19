import { useAuth } from '@clerk/react'
import type { GroupDTO } from '@squadsplit/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useApi } from '../api'
import { ConfirmBar } from '../components/ConfirmBar'
import { ErrorNote } from '../components/ErrorNote'
import { GroupUnavailable } from '../components/GroupUnavailable'
import { InviteCard } from '../components/InviteCard'
import { MemberList } from '../components/MemberList'
import { UiIcon } from '../design/icons'
import { peopleOf, useGroup, useGroupMutation } from '../groupData'
import { membershipErrorText } from '../membershipErrors'
import { invalidateGroup, queryKeys } from '../queryKeys'

const MAX_NAME = 50

/** `/groups/:id/settings`: inviting friends, the member list, renaming (owner) and leaving (members). */
export function GroupSettings() {
  const id = useParams().id ?? ''
  const me = useAuth().userId ?? ''
  const group = useGroup(id)

  if (group.isPending) {
    return (
      <main className="page">
        <p className="empty">Loading the group…</p>
      </main>
    )
  }
  if (group.isError) return <GroupUnavailable error={group.error} />

  const g = group.data
  const isOwner = g.ownerId === me
  return (
    <main className="narrow page">
      <div className="page-h">
        <h2>Group settings</h2>
        <Link to={`/groups/${id}`} className="btn small ghost">
          Back to the group
        </Link>
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
        {isOwner && <RenameCard group={g} />}
        <MemberList group={g} me={me} />
        {!isOwner && <LeaveCard group={g} me={me} />}
      </div>
    </main>
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
  const navigate = useNavigate()
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
