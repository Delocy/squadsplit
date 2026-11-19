import type { CSSProperties } from 'react'
import { Link } from 'react-router'
import { Avatar } from '../design/Avatar'
import { CushionArt, LockedStickerArt, UiIcon, WashiArt, ZeeArt } from '../design/icons'
import type { People } from '../groupData'
import { STICKER_COUNT } from './StickerSheet'

/** How many sleepers fit on the cushion at 375px; the rest are counted. */
const ON_CUSHION = 6

/**
 * A group with no expenses yet: the squad naps on a cushion until someone adds the first one, on a taped album page
 * with an empty slot for each sticker to collect.
 */
export function SquadNap({ people, addExpense }: { people: People; addExpense: string }) {
  const sleepers = people.active.slice(0, ON_CUSHION)
  const more = people.active.length - sleepers.length
  return (
    <section className="card nap-card album" aria-labelledby="nap-h">
      <i className="tape t1">
        <WashiArt color="#cdb4ff" />
      </i>
      <i className="tape t2">
        <WashiArt color="#fff1a8" />
      </i>
      <div className="nap" aria-hidden="true">
        {sleepers.map((m, i) => (
          <span className="sleeper" key={m.userId} style={{ '--i': i } as CSSProperties}>
            <Avatar avatar={m.avatar} size="lg" mood="happy" />
          </span>
        ))}
        {more > 0 && <span className="sleeper more">+{more}</span>}
        <CushionArt />
        <i className="zz z1">
          <ZeeArt />
        </i>
        <i className="zz z2">
          <ZeeArt />
        </i>
        <i className="zz z3">
          <ZeeArt />
        </i>
      </div>
      <h3 id="nap-h" className="es-t">
        The squad is napping.
      </h3>
      <p className="es-s">Add the first expense to wake them up.</p>
      <p className="es-s small">Six stickers to collect:</p>
      <div className="slots" aria-hidden="true">
        {Array.from({ length: STICKER_COUNT }, (_, i) => (
          <span className="slot-s" key={i}>
            <LockedStickerArt />
          </span>
        ))}
      </div>
      <Link to={addExpense} preventScrollReset className="btn primary">
        <UiIcon name="plus" />
        Add expense
      </Link>
    </section>
  )
}
