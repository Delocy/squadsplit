import { Link } from 'react-router'
import { Mascot } from '../design/icons'

export function Logo({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="logo">
      <span className="mark">
        <Mascot kind="bunny" face="#ffffff" mood="happy" />
      </span>
      <h1>SquadSplit</h1>
    </Link>
  )
}
