import { Mascot, type Mood } from '../design/icons'
import { PageLink } from './PageLink'

/** The SquadSplit pup (a cream cavapoo), the logo mark. It is never an avatar. */
export const LogoPup = ({ mood = 'happy' }: { mood?: Mood }) => <Mascot kind="dog" face="#f2e3c9" mood={mood} />

export function Logo({ to = '/' }: { to?: string }) {
  return (
    <PageLink to={to} className="logo">
      <span className="mark">
        <LogoPup />
      </span>
      <h1>SquadSplit</h1>
    </PageLink>
  )
}
