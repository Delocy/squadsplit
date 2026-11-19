import { defaultAvatar, type GroupDTO } from '@squadsplit/shared'
import { useQueries } from '@tanstack/react-query'
import { useState, type CSSProperties } from 'react'
import { ApiError, guestApi } from '../api'
import { PageLink } from '../components/PageLink'
import { lookOf } from '../design/Avatar'
import { Mascot } from '../design/icons'
import { queryKeys } from '../queryKeys'
import { dropGuestPass, guestPassGroupIds, readGuestPass } from './guestPass'

/**
 * On the signed-out landing page: the groups this phone is a guest in, each read with its own pass. A pass that no
 * longer works (401 guest_signed_out: signed out by a reset or "Free up name"; 404: the group is gone for them) is forgotten.
 */
export function OnThisPhone() {
  const [groupIds] = useState(guestPassGroupIds)
  const groups = useQueries({
    queries: groupIds.map((id) => ({
      queryKey: queryKeys.group(id),
      queryFn: async () => {
        try {
          return await guestApi(id).get<GroupDTO>(`/groups/${id}`)
        } catch (err) {
          // A 401 guest_signed_out has already dropped the pass (see guestAuthFor).
          if (err instanceof ApiError && err.status === 404) dropGuestPass(id)
          throw err
        }
      },
    })),
  })
  const shown = groups.flatMap((q) => (q.data ? [q.data] : []))
  if (shown.length === 0) return null

  return (
    <section className="on-this-phone" aria-labelledby="on-this-phone-h">
      <h3 id="on-this-phone-h">On this phone</h3>
      <ul className="groups" aria-label="On this phone">
        {shown.map((g) => (
          <PhoneGroup key={g.id} group={g} />
        ))}
      </ul>
    </section>
  )
}

function PhoneGroup({ group }: { group: GroupDTO }) {
  const look = lookOf(defaultAvatar(group.id))
  const userId = readGuestPass(group.id)?.userId
  const me = group.members.find((m) => m.userId === userId)
  return (
    <li>
      <PageLink to={`/groups/${group.id}`} className="card group-card">
        <span className="tile" style={{ '--tb': look.bg } as CSSProperties}>
          <Mascot kind={look.kind} face={look.face} mood="happy" />
        </span>
        <span className="grow">
          <span className="name">{group.name}</span>
          {me && <span className="sub">as {me.displayName}</span>}
        </span>
      </PageLink>
    </li>
  )
}
