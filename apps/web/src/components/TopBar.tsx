import { SignOutButton, useAuth } from '@clerk/react'
import { defaultAvatar, type AvatarChoice } from '@squadsplit/shared'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useLocation, useParams } from 'react-router'
import { Avatar } from '../design/Avatar'
import { useGroupAccess } from '../guest/GroupAccess'
import { SaveWithAccount } from '../guest/SaveWithAccount'
import { balanceMood } from '../design/mood'
import { Skeleton, SkText } from '../design/Skeleton'
import { useCachedBalances, useGroup } from '../groupData'
import { useMe } from '../useProfileRefresh'
import { GuestTag } from './GuestTag'
import { Logo } from './Logo'
import { PageLink } from './PageLink'

export function TopBar() {
  const { userId } = useAuth()
  const groupId = useParams().id
  const guest = useGroupAccess()?.guest
  return (
    <header className="top">
      <Logo to={userId ? '/groups' : '/'} />
      {groupId && <GroupCrumb id={groupId} />}
      {groupId && guest ? <GuestMe groupId={groupId} userId={guest.userId} /> : userId && <AccountMe userId={userId} groupId={groupId} />}
    </header>
  )
}

/** The signed-in user: their avatar (with its menu) and Sign out. */
function AccountMe({ userId, groupId }: { userId: string; groupId: string | undefined }) {
  const me = useMe()
  // Null while your profile loads, so the default look doesn't flash before yours. If it can't load, the default.
  const profileLook = me.isPending ? null : (me.data?.profileAvatar ?? defaultAvatar(userId))
  return (
    <div className="me">
      <MeMenu
        avatar={groupId ? <MyGroupAvatar groupId={groupId} userId={userId} fallback={profileLook} /> : <MyAvatar avatar={profileLook} />}
      />
      <SignOutButton>
        <button className="btn small ghost">Sign out</button>
      </SignOutButton>
    </div>
  )
}

/** A guest, in the group they're a guest in: how the group sees them, tagged Guest, and a way to keep it. */
function GuestMe({ groupId, userId }: { groupId: string; userId: string }) {
  return (
    <div className="me">
      <MyGroupAvatar groupId={groupId} userId={userId} fallback={defaultAvatar(userId)} />
      <GuestTag />
      <SaveWithAccount groupId={groupId} />
    </div>
  )
}

/** Your avatar opens a small menu with a link to your profile look. It closes on Escape, a click away, or moving on. */
function MeMenu({ avatar }: { avatar: ReactNode }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const { pathname } = useLocation()
  useEffect(() => setOpen(false), [pathname])
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !open) return
    setOpen(false)
    button.current?.focus()
  }

  return (
    <div className="me-menu" ref={box} onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className="me-button"
        aria-label="Your menu"
        aria-expanded={open}
        aria-controls="me-menu-list"
        onClick={() => setOpen((o) => !o)}
      >
        {avatar}
      </button>
      {open && (
        <div className="me-pop card" id="me-menu-list">
          <PageLink to="/me" className="me-pop-link">
            Your profile look
          </PageLink>
        </div>
      )}
    </div>
  )
}

/**
 * Your avatar, or its place held (an avatar-sized skeleton) while it isn't known yet. With `net` (your balance in the
 * group) it wears your mood there.
 */
function MyAvatar({ avatar, net }: { avatar: AvatarChoice | null; net?: number }) {
  if (!avatar) return <Skeleton w={34} h={34} circle />
  return <Avatar avatar={avatar} title="You" {...(net === undefined ? {} : balanceMood(net))} />
}

/**
 * Inside a group you look the way that group sees you (your profile look until it loads, or if you're not in it), in
 * your mood there once a page in it has loaded the balances (the top bar never fetches them itself).
 */
function MyGroupAvatar({ groupId, userId, fallback }: { groupId: string; userId: string; fallback: AvatarChoice | null }) {
  const group = useGroup(groupId)
  const net = useCachedBalances(groupId).data?.balances[userId]
  return <MyAvatar avatar={group.data?.members.find((m) => m.userId === userId)?.avatar ?? fallback} net={net} />
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
