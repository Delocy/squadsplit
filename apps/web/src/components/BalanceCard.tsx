import { formatMoney, type AvatarChoice } from '@squadsplit/shared'
import { Avatar, lookOf, Sweat } from '../design/Avatar'
import { Mascot, WashiArt } from '../design/icons'
import { balanceMood, moodOf, sweatOf } from '../design/mood'
import { squadQuip } from '../squadQuip'

/** Someone else in the group, for the squad strip. */
export interface SquadMember {
  userId: string
  name: string
  avatar: AvatarChoice
  /** Their net balance in the group. */
  cents: number
}

/**
 * Your balance in the group, with your animal from the group in a matching mood: it bobs when you're owed or square,
 * and shivers (and sweats, more for a bigger debt) when you owe. Below it, "the squad": everyone else's animal in
 * their own mood. Your mascot sits in a taped polaroid. `seed` picks the wording of the quip, so it changes as the
 * group's history grows.
 */
export function BalanceCard({
  cents,
  currency,
  avatar,
  seed,
  squad = [],
}: {
  cents: number
  currency: string
  avatar: AvatarChoice
  seed: number
  squad?: SquadMember[]
}) {
  const kind = cents > 0 ? 'owed' : cents < 0 ? 'owe' : 'even'
  const look = lookOf(avatar)
  return (
    <section className={`card balance ${kind}`} aria-label="Your balance">
      <i className="tape t2">
        <WashiArt color="#b8f2d8" />
      </i>
      <div className="polaroid">
        <div className="buddy-w">
          <div className="buddy">
            <Mascot kind={look.kind} face={look.face} mood={moodOf(cents)} />
          </div>
          <Sweat drops={sweatOf(cents)} />
        </div>
        <i className="tape t1">
          <WashiArt color="#ffc8dd" />
        </i>
      </div>
      <div>
        <div className="lbl">{kind === 'owed' ? "You're owed" : kind === 'owe' ? 'You owe' : 'Your balance'}</div>
        <div className="amt">{kind === 'even' ? 'All square' : formatMoney(Math.abs(cents), currency)}</div>
        <div className="quip">{squadQuip({ animal: look.kind, cents, squad, seed })}</div>
      </div>
      {squad.length > 0 && (
        <div className="watching" role="group" aria-label="The squad">
          <span aria-hidden="true">The squad</span>
          {squad.map((m) => (
            <Avatar key={m.userId} avatar={m.avatar} size="sm" title={m.name} {...balanceMood(m.cents)} />
          ))}
        </div>
      )}
    </section>
  )
}
