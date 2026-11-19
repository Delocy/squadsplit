import { SignOutButton, useAuth } from '@clerk/react'
import { defaultAvatar } from '@squadsplit/shared'
import { useParams } from 'react-router'
import { Avatar } from '../design/Avatar'
import { SkText } from '../design/Skeleton'
import { balanceMood } from '../design/mood'
import { useCachedBalances, useGroup } from '../groupData'
import { Logo } from './Logo'

export function TopBar() {
  const { userId } = useAuth()
  const groupId = useParams().id
  return (
    <header className="top">
      <Logo to="/groups" />
      {groupId && <GroupCrumb id={groupId} />}
      {userId && (
        <div className="me">
          {groupId ? <MyGroupAvatar groupId={groupId} userId={userId} /> : <Avatar avatar={defaultAvatar(userId)} title="You" />}
          <SignOutButton>
            <button className="btn small ghost">Sign out</button>
          </SignOutButton>
        </div>
      )}
    </header>
  )
}

/** Inside a group you look the way that group sees you (your default until it loads, or if you're not in it), in your mood there. */
function MyGroupAvatar({ groupId, userId }: { groupId: string; userId: string }) {
  const group = useGroup(groupId)
  // Your mood in the group, once a page in it has loaded the balances (the top bar never fetches them itself).
  const net = useCachedBalances(groupId).data?.balances[userId]
  const avatar = group.data?.members.find((m) => m.userId === userId)?.avatar ?? defaultAvatar(userId)
  return <Avatar avatar={avatar} title="You" {...(net === undefined ? {} : balanceMood(net))} />
}

/** "/ Bali Trip · 4 members" on every page inside a group. Its place is held while it loads, so the page doesn't move. */
function GroupCrumb({ id }: { id: string }) {
  const group = useGroup(id)
  if (group.isPending) {
    return (
      <div className="crumb" aria-hidden="true">
        / <b>
          <SkText w={150} />
        </b>
      </div>
    )
  }
  if (!group.data) return null
  const count = group.data.members.filter((m) => m.active).length
  return (
    <div className="crumb">
      / <b>{group.data.name}</b> <span>· {count === 1 ? '1 member' : `${count} members`}</span>
    </div>
  )
}
