import type { AvatarChoice } from '@squadsplit/shared'
import { mascot } from '../design/art'
import { lookOf } from '../design/Avatar'
import type { Slice } from '../wheel'

const INK = '#3d2c42'
const R = 100

const point = (deg: number, r: number) => {
  const rad = ((deg - 90) * Math.PI) / 180
  return [r * Math.cos(rad), r * Math.sin(rad)] as const
}

/** One pastel slice per person in their avatar colour, with their animal on it. Ported from the playground's renderWheel. */
function SliceArt({ slice, avatar }: { slice: Slice; avatar: AvatarChoice }) {
  const look = lookOf(avatar)
  const sweepRad = (slice.sweep * Math.PI) / 180
  const size = Math.min(42, 20 + sweepRad * 14)
  const [fx, fy] = point(slice.start + slice.sweep / 2, 62)
  const art = mascot(look.kind, look.face, 'calm').replace('<svg', `<svg width="${size}" height="${size}"`)
  const [x1, y1] = point(slice.start, R)
  const [x2, y2] = point(slice.start + slice.sweep, R)
  // A lone slice is the whole disc; an arc from a point back to itself would draw nothing.
  const shape =
    slice.sweep >= 359.999
      ? { d: `M0 ${-R} A${R} ${R} 0 1 1 0 ${R} A${R} ${R} 0 1 1 0 ${-R} Z` }
      : { d: `M0 0 L${x1} ${y1} A${R} ${R} 0 ${slice.sweep > 180 ? 1 : 0} 1 ${x2} ${y2} Z` }
  return (
    <>
      <path {...shape} data-user={slice.userId} fill={look.bg} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
      {/* Static, trusted art from design/art. */}
      <g transform={`translate(${fx - size / 2} ${fy - size / 2})`} dangerouslySetInnerHTML={{ __html: art }} />
    </>
  )
}

/** The wheel: a dark rim, the slices, a white hub, and the pointer at the top. `rotation` turns it, with a 3s ease (see .wheel in tokens.css). */
export function WheelDisc({
  slices,
  rotation,
  avatarOf,
}: {
  slices: Slice[]
  rotation: number
  /** Each person's look in the group. */
  avatarOf: (userId: string) => AvatarChoice
}) {
  return (
    <div className="wheel">
      <div className="ptr" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M4 3h16L12 21z" fill="#f0609a" stroke={INK} strokeWidth={2.4} strokeLinejoin="round" />
        </svg>
      </div>
      <svg viewBox="-112 -112 224 224" role="img" aria-label="The wheel" style={{ transform: `rotate(${rotation}deg)` }}>
        <circle r={104} fill={INK} />
        {slices.map((s) => (
          <SliceArt key={s.userId} slice={s} avatar={avatarOf(s.userId)} />
        ))}
        <circle r={13} fill="#fff" stroke={INK} strokeWidth={3} />
      </svg>
    </div>
  )
}
