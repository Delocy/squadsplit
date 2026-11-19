import { formatMoney, type SettlementDTO } from '@squadsplit/shared'
import type { CSSProperties } from 'react'
import { Avatar } from '../design/Avatar'
import { HeartArt } from '../design/icons'
import { useReducedMotion } from '../design/motion'
import type { People } from '../groupData'

/** How many of the rest of the squad cheer; more would wrap at 375px. */
const CHEERING = 6

/**
 * The moment you confirm a payback: a heart hops from the payer to you, the payer's face stops frowning, and the
 * rest of the squad does a cheer wave. It plays once (see .moment in fun.css) and stays until closed. Under reduced
 * motion it is drawn in its final, still state. The amount never moves.
 */
export function SettleMoment({
  settlement,
  me,
  people,
  currency,
  onClose,
}: {
  settlement: SettlementDTO
  me: string
  people: People
  currency: string
  onClose: () => void
}) {
  const still = useReducedMotion()
  const payer = settlement.fromUserId
  const squad = people.active.filter((m) => m.userId !== payer && m.userId !== me).slice(0, CHEERING)
  return (
    <section className={still ? 'moment still' : 'moment'} role="status" aria-label="Payback confirmed">
      <div className="duo" aria-hidden="true">
        <span className="hop-l">
          <span className="swap">
            <Avatar avatar={people.avatar(payer)} size="xl" mood="happy" />
            {!still && (
              <span className="swap-from">
                <Avatar avatar={people.avatar(payer)} size="xl" mood="nervous" sweat={1} />
              </span>
            )}
          </span>
        </span>
        <span className="heart-hop">
          <HeartArt />
        </span>
        <span className="hop-r">
          <Avatar avatar={people.avatar(me)} size="xl" mood="happy" />
        </span>
      </div>
      {squad.length > 0 && (
        <div className="cheer">
          {squad.map((m, i) => (
            <span className="wave" key={m.userId} style={{ '--i': i } as CSSProperties}>
              <Avatar avatar={m.avatar} size="lg" mood="happy" title={m.displayName} />
            </span>
          ))}
        </div>
      )}
      <p className="caption">
        {people.name(payer)} paid you {formatMoney(settlement.amountCents, currency)}. The squad approves.
      </p>
      <button type="button" className="btn small ghost" onClick={onClose}>
        Close
      </button>
    </section>
  )
}
