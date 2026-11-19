import type { Badge, BadgeKey } from '@squadsplit/shared'
import { useRef, type CSSProperties } from 'react'
import { BadgeArt, LockedStickerArt } from '../design/icons'
import type { People } from '../groupData'

/** Every title the group can hand out (computeBadges in @squadsplit/shared), in its order, as a sticker book page. */
const STICKERS: { key: BadgeKey; title: string; tilt: number }[] = [
  { key: 'debt_goblin', title: 'Debt Goblin', tilt: -6 },
  { key: 'biggest_spender', title: 'Biggest Spender', tilt: 4 },
  { key: 'ghost', title: 'Ghost', tilt: -3 },
  { key: 'bar_tab', title: 'Bar Tab Champion', tilt: 7 },
  { key: 'good_egg', title: 'Good Egg', tilt: -5 },
  { key: 'wheel_victim', title: 'Wheel Victim', tilt: 3 },
]

/** How many stickers there are to collect. */
export const STICKER_COUNT = STICKERS.length

export interface StickerSlot {
  key: BadgeKey
  title: string
  tilt: number
  /** Who holds the title now; nobody yet means an empty, dashed slot. */
  holders: string[]
}

/** The group's titles as a sticker sheet: one slot per title, and how many have been collected. */
export function stickerSheet(badges: Badge[]): { slots: StickerSlot[]; collected: number } {
  const slots = STICKERS.map((s) => ({ ...s, holders: badges.filter((b) => b.key === s.key).map((b) => b.userId) }))
  return { slots, collected: slots.filter((s) => s.holders.length > 0).length }
}

/**
 * "Sticker book, 4 of 6": the titles as die-cut stickers, tilted, with a corner that peels up on hover, and dashed
 * slots for the ones nobody holds yet. A sticker earned while you watch slaps on; the ones there when the page
 * loaded are simply there.
 */
export function StickerSheet({ badges, people }: { badges: Badge[]; people: People }) {
  const { slots, collected } = stickerSheet(badges)
  const held = slots.filter((s) => s.holders.length > 0).map((s) => s.key)
  const atFirst = useRef(new Set(held))
  return (
    <div className="sheet" role="group" aria-label="Sticker book">
      <div className="sheet-h">
        Sticker book <b>{`${collected} of ${STICKER_COUNT}`}</b>
      </div>
      <div className="stickers">
        {slots.map((s) =>
          s.holders.length ? (
            <div
              className={atFirst.current.has(s.key) ? 'sticker' : 'sticker slap'}
              key={s.key}
              style={{ '--r': `${s.tilt}deg` } as CSSProperties}
            >
              <span className="die">
                <BadgeArt badgeKey={s.key} />
              </span>
              <span className="cap">
                <b>{s.title}</b>
                <em>{s.holders.map((id) => people.name(id)).join(', ')}</em>
              </span>
            </div>
          ) : (
            <div className="sticker locked" key={s.key}>
              <span className="die">
                <LockedStickerArt />
              </span>
              <span className="cap">
                <b aria-hidden="true">???</b>
                <em aria-hidden="true">keep going</em>
                <span className="sr-only">Not collected yet</span>
              </span>
            </div>
          ),
        )}
      </div>
    </div>
  )
}
