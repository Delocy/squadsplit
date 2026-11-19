import { Link } from 'react-router'
import { Mascot, type Mood } from '../design/icons'

/** The SquadSplit pup (an apricot cavapoo), the logo mark. It is never an avatar. */
export const LogoPup = ({ mood = 'happy' }: { mood?: Mood }) => <Mascot kind="dog" face="#fcd9b6" mood={mood} />

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
