import { MAX_GROUP_MEMBERS, type GroupDTO, type MemberDTO } from '@squadsplit/shared'
import { useApi } from '../api'
import { Avatar } from '../design/Avatar'
import { UiIcon } from '../design/icons'
import { useGroupMutation } from '../groupData'
import { membershipErrorText } from '../membershipErrors'
import { ConfirmBar, useConfirmStep } from './ConfirmBar'
import { ErrorNote } from './ErrorNote'
import { GuestTag } from './GuestTag'
import { NotJoinedTag } from './NotJoinedTag'

/**
 * Everyone in the group with their role (or a tag for a name that hasn't joined yet, or a guest); the owner can remove others.
 * People who left are folded away.
 */
export function MemberList({ group, me }: { group: GroupDTO; me: string }) {
  const active = group.members.filter((m) => m.active)
  const former = group.members.filter((m) => !m.active)
  const isOwner = group.ownerId === me
  return (
    <section className="card" aria-labelledby="members-h">
      <h3>
        <UiIcon name="sparkle" />
        <span id="members-h">Members</span>
        <span className="right status">
          {active.length}/{MAX_GROUP_MEMBERS} members
        </span>
      </h3>
      <ul className="list" aria-label="Members">
        {active.map((m) => (
          <MemberRow key={m.userId} groupId={group.id} member={m} me={me} isOwner={isOwner} />
        ))}
      </ul>
      {former.length > 0 && (
        <details className="former">
          <summary>Left the group ({former.length})</summary>
          <ul className="list" aria-label="Former members">
            {former.map((m) => (
              <li className="row" key={m.userId}>
                <Avatar avatar={m.avatar} size="sm" faded />
                <div className="grow">{m.displayName}</div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

/** One active member. The owner can remove anyone else, and sign a guest out of every phone ("Free up name"). */
function MemberRow({ groupId, member, me, isOwner }: { groupId: string; member: MemberDTO; me: string; isOwner: boolean }) {
  const api = useApi()
  const confirmRemove = useConfirmStep()
  const confirmRelease = useConfirmStep()
  const remove = useGroupMutation(groupId, () => api.del(`/groups/${groupId}/members/${member.userId}`))
  const release = useGroupMutation(groupId, () => api.post(`/groups/${groupId}/members/${member.userId}/release`))
  const confirming = confirmRemove.showBar || confirmRelease.showBar
  const canRemove = isOwner && member.userId !== me
  const canRelease = isOwner && member.guest
  return (
    <li className="row member">
      <Avatar avatar={member.avatar} />
      <div className="grow">
        <div className="t">
          {member.displayName}
          {member.userId === me && ' (you)'}
        </div>
        <div className="s">
          {member.placeholder ? <NotJoinedTag /> : member.guest ? <GuestTag /> : member.role === 'owner' ? 'Owner' : 'Member'}
        </div>
      </div>
      {canRelease && !confirming && (
        <button ref={confirmRelease.triggerRef} className="btn small ghost" onClick={confirmRelease.open}>
          Free up name
        </button>
      )}
      {canRemove && !confirming && (
        <button ref={confirmRemove.triggerRef} className="btn small ghost danger" onClick={confirmRemove.open}>
          Remove
        </button>
      )}
      {confirmRelease.showBar && (
        <ConfirmBar
          question={`Sign ${member.displayName} out on every phone? Their name and expenses stay, ready to claim again.`}
          yes="Yes, free it up"
          busyLabel="Freeing…"
          busy={release.isPending}
          leaving={confirmRelease.leaving}
          onYes={() => release.mutate(undefined, { onSettled: confirmRelease.close })}
          onCancel={confirmRelease.close}
        />
      )}
      {confirmRemove.showBar && (
        <ConfirmBar
          question={`Remove ${member.displayName} from the group?`}
          yes={`Yes, remove ${member.displayName}`}
          busyLabel="Removing…"
          busy={remove.isPending}
          leaving={confirmRemove.leaving}
          onYes={() => remove.mutate(undefined, { onSettled: confirmRemove.close })}
          onCancel={confirmRemove.close}
        />
      )}
      {remove.isError && (
        <p className="err" role="alert">
          {membershipErrorText(remove.error, member.displayName)}
        </p>
      )}
      {release.isError && <ErrorNote error={release.error} />}
    </li>
  )
}
