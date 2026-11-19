import { formatMoney, type FunDTO, type SettlementDTO } from '@squadsplit/shared'
import { useState, type CSSProperties, type ReactNode } from 'react'
import { Avatar } from '../design/Avatar'
import { BadgeArt, HeartArt, StampArt, UiIcon } from '../design/icons'
import { useReducedMotion } from '../design/motion'
import type { People } from '../groupData'

/** How many of the rest of the squad cheer; more would wrap at 375px. */
const CHEERING = 6

/** Who holds the Good Egg title, or undefined while the titles haven't loaded. */
const goodEggOf = (fun: FunDTO | undefined) => (fun ? (fun.badges.find((b) => b.key === 'good_egg')?.userId ?? null) : undefined)

/**
 * The settle-up moment for paybacks that count: `celebrate` one as soon as the API confirms it, and put `moment`
 * where it should play (it stays until closed). `fun` (the group's titles) tells whether the payback just earned the
 * payer the Good Egg sticker: who held it when it was celebrated against who holds it once the titles are refetched.
 */
export function useSettleMoment({ people, currency, fun }: { people: People; currency: string; fun?: FunDTO }) {
  const [shown, setShown] = useState<{ settlement: SettlementDTO; goodEggBefore: string | null | undefined } | null>(null)
  const celebrate = (settlement: SettlementDTO) => setShown({ settlement, goodEggBefore: goodEggOf(fun) })
  const payer = shown?.settlement.fromUserId
  const moment: ReactNode = shown && (
    <SettleMoment
      settlement={shown.settlement}
      people={people}
      currency={currency}
      newSticker={shown.goodEggBefore !== undefined && shown.goodEggBefore !== payer && goodEggOf(fun) === payer}
      onClose={() => setShown(null)}
    />
  )
  return { moment, celebrate, celebrating: shown?.settlement.id }
}

/**
 * The moment a payback counts (you confirm one, or record one with someone who hasn't joined): a heart hops from
 * the payer to the payee, the payer's face stops frowning, and the rest of the squad does a cheer wave. Then a PAID stamp thunks onto the payback slip, beside the amount, and a
 * newly earned Good Egg sticker slaps on. It plays once (see .moment in fun.css) and stays until closed. Under
 * reduced motion it is drawn in its final, still state. The amount never moves.
 */
export function SettleMoment({
  settlement,
  people,
  currency,
  newSticker = false,
  onClose,
}: {
  settlement: SettlementDTO
  people: People
  currency: string
  /** The payer just earned the Good Egg sticker with this payback. */
  newSticker?: boolean
  onClose: () => void
}) {
  const still = useReducedMotion()
  const payer = settlement.fromUserId
  const payee = settlement.toUserId
  const squad = people.active.filter((m) => m.userId !== payer && m.userId !== payee).slice(0, CHEERING)
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
          <Avatar avatar={people.avatar(payee)} size="xl" mood="happy" />
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
        {people.you(payer)} paid {people.you(payee, true)} back. The squad approves.
      </p>
      <div className="slip">
        <div className="slip-h">
          <UiIcon name="receipt" />
          Payback
        </div>
        <div className="slip-row">
          <Avatar avatar={people.avatar(payer)} size="sm" mood="happy" />
          <span>{people.you(payer)}</span>
          <span className="arrow">
            <UiIcon name="arrow" />
          </span>
          <Avatar avatar={people.avatar(payee)} size="sm" mood="happy" />
          <span>{people.you(payee)}</span>
        </div>
        <div className="slip-amt">{formatMoney(settlement.amountCents, currency)}</div>
        <span className="big-stamp" role="img" aria-label="Paid">
          <StampArt text="PAID" />
        </span>
      </div>
      {newSticker && (
        // Slapped onto the moment's corner, so it takes no room: it can arrive after the refetched titles do.
        <div className="earned">
          <div className="sticker slap" style={{ '--r': '-8deg' } as CSSProperties}>
            <span className="die">
              <BadgeArt badgeKey="good_egg" />
            </span>
          </div>
          <span className="sr-only">New sticker for {people.you(payer, true)}</span>
          <b>Good Egg</b>
        </div>
      )}
      <button type="button" className="btn small ghost" onClick={onClose}>
        Close
      </button>
    </section>
  )
}
