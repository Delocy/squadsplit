import { SignInButton, SignUpButton } from '@clerk/react'
import type { CSSProperties } from 'react'
import { SQUAD } from '../design/Avatar'
import { Mascot } from '../design/icons'
import { Logo } from '../components/Logo'

export function Landing() {
  return (
    <main className="wrap narrow landing">
      <Logo />
      <div className="squad" aria-hidden="true">
        {SQUAD.map((look, i) => (
          <span key={look.kind} className="av lg bob" style={{ '--c': look.bg, '--d': `${i * 0.35}s` } as CSSProperties}>
            <Mascot kind={look.kind} face={look.face} mood={i === 0 ? 'happy' : 'calm'} />
          </span>
        ))}
      </div>
      <h2 className="hero">Split bills, not friendships.</h2>
      <p className="lede">
        Log what everyone paid, see who owes whom, and settle up without the awkward chat.
      </p>
      <div className="cta">
        <SignUpButton mode="modal">
          <button className="btn primary">Get started</button>
        </SignUpButton>
        <SignInButton mode="modal">
          <button className="btn">Sign in</button>
        </SignInButton>
      </div>
    </main>
  )
}
