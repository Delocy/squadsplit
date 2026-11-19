import { MAX_GROUP_MEMBERS, type GroupDTO, type MemberDTO } from '@squadsplit/shared'
import { useState } from 'react'
import { useApi } from '../api'
import { Avatar } from '../design/Avatar'
import { UiIcon } from '../design/icons'
import { useGroupMutation } from '../groupData'
import { membershipErrorText } from '../membershipErrors'
import { ConfirmBar } from './ConfirmBar'

/** Everyone in the group with their role; the owner can remove others. People who left are folded away. */
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
          <MemberRow key={m.userId} groupId={group.id} member={m} me={me} canRemove={isOwner && m.userId !== me} />
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

function MemberRow({ groupId, member, me, canRemove }: { groupId: string; member: MemberDTO; me: string; canRemove: boolean }) {
  const api = useApi()
  const [confirming, setConfirming] = useState(false)
  const remove = useGroupMutation(groupId, () => api.del(`/groups/${groupId}/members/${member.userId}`))
  return (
    <li className="row member">
      <Avatar avatar={member.avatar} />
      <div className="grow">
        <div className="t">
          {member.displayName}
          {member.userId === me && ' (you)'}
        </div>
        <div className="s">{member.role === 'owner' ? 'Owner' : 'Member'}</div>
      </div>
      {canRemove && !confirming && (
        <button className="btn small ghost danger" onClick={() => setConfirming(true)}>
          Remove
        </button>
      )}
      {confirming && (
        <ConfirmBar
          question={`Remove ${member.displayName} from the group?`}
          yes={`Yes, remove ${member.displayName}`}
          busy={remove.isPending}
          onYes={() => remove.mutate(undefined, { onSettled: () => setConfirming(false) })}
          onCancel={() => setConfirming(false)}
        />
      )}
      {remove.isError && (
        <p className="err" role="alert">
          {membershipErrorText(remove.error, member.displayName)}
        </p>
      )}
    </li>
  )
}
