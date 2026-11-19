import type { FeedItem } from '@squadsplit/shared'
import { useParams } from 'react-router'
import { GroupLink } from '../components/GroupLink'
import { GroupUnavailable } from '../components/GroupUnavailable'
import { RowSkeletons, WheelPageSkeleton } from '../components/Skeletons'
import { WheelCard } from '../components/WheelCard'
import { Avatar } from '../design/Avatar'
import { UiIcon } from '../design/icons'
import { peopleOf, useBalances, useFeed, useGroup, type People } from '../groupData'
import { useMyId } from '../guest/GroupAccess'

const RECENT_SPINS = 5

/** `/groups/:id/wheel`: the big "Who pays next?" wheel (the same one as on the group home) and the recent spins. */
export function Wheel() {
  const id = useParams().id ?? ''
  const me = useMyId()
  const group = useGroup(id)
  const balances = useBalances(id)
  const feed = useFeed(id)

  if (group.isError) return <GroupUnavailable error={group.error} />
  // Appears at once when the wheel's odds and the recent spins are in, so nothing on it moves afterwards.
  if (group.isPending || balances.isPending || feed.isPending) return <WheelPageSkeleton />

  const people = peopleOf(group.data, me)
  return (
    <main className="narrow page">
      <div className="page-h">
        <GroupLink groupId={id} className="btn small ghost">
          Back to the group
        </GroupLink>
      </div>
      <WheelCard groupId={id} me={me} people={people} balances={balances.data?.balances} />
      <RecentSpins items={feed.data} me={me} people={people} />
    </main>
  )
}

function RecentSpins({ items, me, people }: { items: FeedItem[] | undefined; me: string; people: People }) {
  const spins = (items ?? []).flatMap((i) => (i.type === 'spin' ? [i.spin] : [])).slice(0, RECENT_SPINS)
  return (
    <section className="card" aria-labelledby="recent-h">
      <h3 id="recent-h">
        <UiIcon name="clock" />
        Recent spins
      </h3>
      <ul className="list">
        {items === undefined ? (
          <RowSkeletons count={3} amount={false} />
        ) : spins.length ? (
          spins.map((s) => (
            <li className="row" key={s.id}>
              <Avatar avatar={people.avatar(s.winnerId)} size="sm" mood="nervous" faded={people.isFormer(s.winnerId)} />
              <div className="grow">
                <div className="t">{s.winnerId === me ? 'You were picked' : `${people.name(s.winnerId)} was picked`}</div>
                <div className="s">Spun by {people.you(s.spunBy, true)}</div>
              </div>
            </li>
          ))
        ) : (
          <li className="empty">No spins yet.</li>
        )}
      </ul>
    </section>
  )
}
