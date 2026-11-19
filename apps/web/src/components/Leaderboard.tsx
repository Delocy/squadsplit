import type { FunDTO } from '@squadsplit/shared'
import type { CSSProperties } from 'react'
import { Avatar } from '../design/Avatar'
import { Medal, UiIcon } from '../design/icons'
import { balanceMood } from '../design/mood'
import type { People } from '../groupData'
import { Money } from './Money'
import { LeaderboardSkeleton } from './Skeletons'
import { StickerSheet } from './StickerSheet'

/** Members ranked by net balance (most owed first) with a centred bar, then the titles as a sticker sheet. */
export function Leaderboard({ fun, people, currency }: { fun: FunDTO | undefined; people: People; currency: string }) {
  return (
    <section className="card" aria-labelledby="leaderboard-h">
      <h3 id="leaderboard-h">
        <UiIcon name="trophy" />
        Leaderboard
      </h3>
      {fun ? <Board fun={fun} people={people} currency={currency} /> : <LeaderboardSkeleton rows={people.active.length} />}
    </section>
  )
}

function Board({ fun, people, currency }: { fun: FunDTO; people: People; currency: string }) {
  const board = fun.leaderboard
  const maxAbs = Math.max(1, ...board.map((b) => Math.abs(b.netCents)))
  return (
    <>
      <div className="lb">
        {board.map((b) => {
          const width = `${(Math.abs(b.netCents) / maxAbs) * 50}%`
          const fill: CSSProperties =
            b.netCents >= 0
              ? { left: '50%', width, background: 'var(--good)' }
              : { right: '50%', width, background: 'var(--bad)' }
          return (
            <div className="lb-row" key={b.userId}>
              <Medal rank={b.rank} />
              <span className="who">
                <Avatar avatar={people.avatar(b.userId)} size="sm" {...balanceMood(b.netCents)} />
                <span>{people.name(b.userId)}</span>
              </span>
              <span className="bar">
                <i style={fill} />
              </span>
              <span className="num">
                <Money cents={b.netCents} currency={currency} signed />
              </span>
            </div>
          )
        })}
      </div>
      <StickerSheet badges={fun.badges} people={people} />
    </>
  )
}
