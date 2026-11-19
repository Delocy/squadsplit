import { Link } from 'react-router'
import { Mascot, type Mood } from '../design/icons'

/** The SquadSplit pup, the logo mark. Avatars stay the four other animals. */
export const LogoPup = ({ mood = 'happy' }: { mood?: Mood }) => <Mascot kind="dog" face="#f6e0bf" mood={mood} />

export function Logo({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="logo">
      <span className="mark">
        <LogoPup />
      </span>
      <h1>SquadSplit</h1>
    </Link>
  )
}
