import type { ReactNode } from 'react'
import { Skeleton, SkText } from '../design/Skeleton'
import { UiIcon, type UiIconName } from '../design/icons'
import { STICKER_COUNT } from './StickerSheet'

// Loading states shaped like the pages and cards they stand in for (same classes, same sizes), so nothing jumps
// when the data arrives. Each page skeleton is announced once, by its status line, and hidden from screen readers.

const range = (n: number) => Array.from({ length: n }, (_, i) => i)

/** Says what is loading, for screen readers only. */
const Status = ({ children }: { children: string }) => (
  <p className="sr-only" role="status">
    {children}
  </p>
)

/** A card heading as the real card has it: static, so it shows straight away. */
const Heading = ({ icon, children }: { icon: UiIconName; children: ReactNode }) => (
  <h3>
    <UiIcon name={icon} />
    {children}
  </h3>
)

/** Rows of a `ul.list` (activity, settle up, recent spins, members): a tile or avatar, two lines of text, an amount. */
export function RowSkeletons({ count, lead = 'avatar', amount = true }: { count: number; lead?: 'tile' | 'avatar'; amount?: boolean }) {
  return (
    <>
      {range(count).map((i) => (
        <li className="row" key={i} aria-hidden="true">
          {lead === 'tile' ? <Skeleton w={38} h={38} r={11} /> : <Skeleton w={26} h={26} circle />}
          <div className="grow">
            <div className="t">
              <SkText w="60%" />
            </div>
            <div className="s">
              <SkText w="40%" />
            </div>
          </div>
          {amount && (
            <div className="amt-r">
              <SkText w={56} />
            </div>
          )}
        </li>
      ))}
    </>
  )
}

/** Inside a `.card.balance`: the empty mascot circle and the label, amount and quip lines. */
function BalanceSkeleton() {
  return (
    <>
      <Skeleton className="buddy" circle />
      <div aria-hidden="true">
        <div className="lbl">
          <SkText w={90} />
        </div>
        <div className="amt">
          <SkText w={140} />
        </div>
        <div className="quip">
          <SkText w="70%" />
        </div>
      </div>
    </>
  )
}

/** Leaderboard rows (medal, avatar and name, bar, amount) and the sticker sheet of titles. */
export function LeaderboardSkeleton({ rows }: { rows: number }) {
  return (
    <>
      <div className="lb" aria-hidden="true">
        {range(rows).map((i) => (
          <div className="lb-row" key={i}>
            <Skeleton w={24} h={24} circle />
            <span className="who">
              <Skeleton w={26} h={26} circle />
              <SkText w="55%" />
            </span>
            <span className="bar" />
            <span className="num">
              <SkText w={64} />
            </span>
          </div>
        ))}
      </div>
      <div className="sheet" aria-hidden="true">
        <div className="sheet-h">
          <SkText w={90} />
          <b>
            <SkText w={36} />
          </b>
        </div>
        <div className="stickers">
          {range(STICKER_COUNT).map((i) => (
            <div className="sticker" key={i}>
              <Skeleton className="die" circle />
              <span className="cap">
                <b>
                  <SkText w={64} />
                </b>
                <em>
                  <SkText w={40} />
                </em>
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

/** The "Who pays next?" card: its text, a round wheel, odds rows and the Spin button. */
function WheelCardSkeleton({ compact }: { compact: boolean }) {
  return (
    <div className={compact ? 'card wheel-card compact' : 'card wheel-card'} aria-hidden="true">
      <Heading icon="wheel">Who pays next?</Heading>
      <p className="s">Can't decide who gets the next round? Spin the wheel. People who owe more are more likely to be picked.</p>
      <div className="wheel-wrap">
        <div className="wheel">
          <Skeleton w="100%" h="100%" circle />
        </div>
        <div>
          <ul className="odds">
            {range(2).map((i) => (
              <li key={i}>
                <Skeleton w={26} h={26} circle />
                <SkText w={70} />
                <b>
                  <SkText w={32} />
                </b>
              </li>
            ))}
          </ul>
          <div className="spin-row">
            <Skeleton w={78} h={37} r={12} />
          </div>
        </div>
      </div>
      <div className="slot" />
      <div className="relief" />
      {compact && <Skeleton w={128} h={27} r={10} className="recent-spins" />}
    </div>
  )
}

/** `/groups` before the list arrives: three group cards. */
export function GroupsSkeleton() {
  return (
    <>
      <Status>Loading your groups…</Status>
      <ul className="groups" aria-hidden="true">
        {range(3).map((i) => (
          <li key={i}>
            <div className="card group-card">
              <Skeleton w={48} h={48} r={14} />
              <span className="grow">
                <span className="name">
                  <SkText w={160} />
                </span>
                <Skeleton w={58} h={16} r={99} />
              </span>
              <span className="amt-r">
                <SkText w={64} />
              </span>
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}

const STATS = ['Group spend', 'Your share', 'You paid']

/** `/groups/:id` before the group arrives: the summary strip, the main column and the side column. */
export function GroupHomeSkeleton() {
  return (
    <main className="page" aria-busy="true">
      <Status>Loading the group…</Status>
      <div className="summary" aria-hidden="true">
        <div className="card balance even">
          <BalanceSkeleton />
        </div>
        <div className="card">
          <div className="stats">
            {STATS.map((k) => (
              <div className="stat" key={k}>
                <div className="k">{k}</div>
                <div className="v">
                  <SkText w="70%" />
                </div>
              </div>
            ))}
          </div>
          <div className="quick">
            <Skeleton w={132} h={37} r={12} className="add-desktop" />
            <Skeleton w={150} h={37} r={12} />
            <Skeleton w={124} h={37} r={12} />
          </div>
        </div>
      </div>
      <div className="main" aria-hidden="true">
        <div className="col">
          <div className="card">
            <Heading icon="heart">Settle up</Heading>
            <ul className="list">
              <RowSkeletons count={1} />
            </ul>
          </div>
          <div className="card">
            <h3>
              <UiIcon name="receipt" />
              Activity
              <Skeleton w={170} h={30} r={11} className="right" />
            </h3>
            <ul className="list">
              <RowSkeletons count={4} lead="tile" />
            </ul>
          </div>
        </div>
        <div className="col">
          <div className="card">
            <Heading icon="trophy">Leaderboard</Heading>
            <LeaderboardSkeleton rows={3} />
          </div>
          <WheelCardSkeleton compact />
        </div>
      </div>
    </main>
  )
}

/** `/groups/:id/wheel` before the group arrives. */
export function WheelPageSkeleton() {
  return (
    <main className="narrow page" aria-busy="true">
      <Status>Loading the group…</Status>
      <div className="page-h" aria-hidden="true">
        <Skeleton w={132} h={27} r={10} />
      </div>
      <WheelCardSkeleton compact={false} />
      <div className="card" aria-hidden="true">
        <Heading icon="clock">Recent spins</Heading>
        <ul className="list">
          <RowSkeletons count={3} amount={false} />
        </ul>
      </div>
    </main>
  )
}

/** `/groups/:id/settings` before the group arrives: the invite, you-in-this-group and member cards. */
export function SettingsSkeleton() {
  return (
    <main className="narrow page" aria-busy="true">
      <Status>Loading the group…</Status>
      <div className="page-h" aria-hidden="true">
        <h2>Group settings</h2>
        <Skeleton w={132} h={27} r={10} />
      </div>
      <div className="col" aria-hidden="true">
        <div className="card">
          <Heading icon="heart">Invite friends</Heading>
          <div className="invite">
            <div className="qr-box">
              <Skeleton h={152} r={6} />
            </div>
            <div className="invite-side">
              <p className="s">
                <SkText w={220} />
              </p>
              <Skeleton h={42} r={12} />
              <Skeleton w={130} h={27} r={10} />
            </div>
          </div>
        </div>
        <div className="card">
          <Heading icon="star">You in this group</Heading>
          <Skeleton h={42} r={12} />
          <Skeleton h={160} r={14} style={{ marginTop: 14 }} />
        </div>
        <div className="card">
          <Heading icon="sparkle">Members</Heading>
          <ul className="list">
            <RowSkeletons count={3} amount={false} />
          </ul>
        </div>
      </div>
    </main>
  )
}

/** `/me` before your profile arrives. */
export function ProfileSkeleton() {
  return (
    <main className="narrow page" aria-busy="true">
      <Status>Loading your profile look…</Status>
      <div className="page-h" aria-hidden="true">
        <h2>Your profile look</h2>
        <Skeleton w={150} h={27} r={10} />
      </div>
      <div className="card" aria-hidden="true">
        <Heading icon="star">Your animal</Heading>
        <p className="s">
          <SkText w={260} />
        </p>
        <Skeleton h={44} r={12} />
        <Skeleton h={160} r={14} style={{ marginTop: 12 }} />
      </div>
    </main>
  )
}

/** `/join/:code` before the invite preview arrives. */
export function JoinSkeleton() {
  return (
    <main className="narrow page" aria-busy="true">
      <Status>Checking the invite…</Status>
      <div className="card join" aria-hidden="true">
        <Skeleton w={84} h={84} circle />
        <p className="lbl">
          <SkText w={110} />
        </p>
        <h2>
          <SkText w={170} />
        </h2>
        <p className="empty">
          <SkText w={80} />
        </p>
        <Skeleton h={42} r={12} />
        <Skeleton h={180} r={14} />
        <Skeleton w={118} h={37} r={12} />
      </div>
    </main>
  )
}

/** The expense dialog's fields before the group arrives. */
export function ExpenseFormSkeleton() {
  return (
    <>
      <Status>Loading…</Status>
      <div aria-hidden="true">
        <div className="two">
          <Skeleton h={42} r={12} style={{ marginTop: 34 }} />
          <Skeleton h={42} r={12} style={{ marginTop: 34 }} />
        </div>
        <Skeleton w={150} h={42} r={12} style={{ marginTop: 34 }} />
        <Skeleton h={64} r={11} style={{ marginTop: 34 }} />
      </div>
    </>
  )
}
