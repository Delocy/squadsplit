import { SignOutButton, useAuth } from '@clerk/react'
import { Avatar } from '../design/Avatar'
import { Logo } from './Logo'

export function TopBar() {
  const { userId } = useAuth()
  return (
    <header className="top">
      <Logo to="/groups" />
      <div className="spacer" />
      {userId && (
        <div className="me">
          <Avatar userId={userId} title="You" />
          <SignOutButton>
            <button className="btn small ghost">Sign out</button>
          </SignOutButton>
        </div>
      )}
    </header>
  )
}
