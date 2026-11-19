import { SignOutButton, useAuth } from '@clerk/react'
import { defaultAvatar } from '@squadsplit/shared'
import { useParams } from 'react-router'
import { Avatar } from '../design/Avatar'
import { useGroup } from '../groupData'
import { Logo } from './Logo'

export function TopBar() {
  const { userId } = useAuth()
  const groupId = useParams().id
  return (
    <header className="top">
      <Logo to="/groups" />
      {groupId && <GroupCrumb id={groupId} />}
      <div className="spacer" />
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

/** Inside a group you look the way that group sees you (your default until it loads, or if you're not in it). */
function MyGroupAvatar({ groupId, userId }: { groupId: string; userId: string }) {
  const group = useGroup(groupId)
  const avatar = group.data?.members.find((m) => m.userId === userId)?.avatar ?? defaultAvatar(userId)
  return <Avatar avatar={avatar} title="You" />
}

/** "/ Bali Trip · 4 members" on every page inside a group. */
function GroupCrumb({ id }: { id: string }) {
  const group = useGroup(id)
  if (!group.data) return null
  const count = group.data.members.filter((m) => m.active).length
  return (
    <div className="crumb">
      / <b>{group.data.name}</b> <span>· {count === 1 ? '1 member' : `${count} members`}</span>
    </div>
  )
}
