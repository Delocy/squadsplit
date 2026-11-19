import type { CSSProperties } from 'react'
import { Mascot, type Kind, type Mood } from './icons'

const ANIMALS: { kind: Kind; face: string }[] = [
  { kind: 'bunny', face: '#ffffff' },
  { kind: 'bear', face: '#f3d2b3' },
  { kind: 'panda', face: '#ffffff' },
  { kind: 'kitty', face: '#ffe8a3' },
]
const BACKGROUNDS = ['#ffc8dd', '#bde0fe', '#cdb4ff', '#b8f2d8']

/** FNV-1a: a small, stable string hash, so a user keeps the same animal on every device. */
function hash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export interface AvatarLook {
  kind: Kind
  face: string
  bg: string
}

/** The four animals on their signature colours, as in the playground. */
export const SQUAD: AvatarLook[] = ANIMALS.map((a, i) => ({ ...a, bg: BACKGROUNDS[i]! }))

/** The animal and background colour for a user. Same id, same look. */
export function avatarFor(userId: string): AvatarLook {
  const h = hash(userId)
  const animal = ANIMALS[h % ANIMALS.length]!
  const bg = BACKGROUNDS[Math.floor(h / ANIMALS.length) % BACKGROUNDS.length]!
  return { kind: animal.kind, face: animal.face, bg }
}

export function Avatar({
  userId,
  size,
  mood = 'calm',
  title,
  faded = false,
}: {
  userId: string
  size?: 'sm' | 'lg'
  mood?: Mood
  title?: string
  /** Greyed out, for someone who has left the group. */
  faded?: boolean
}) {
  const look = avatarFor(userId)
  return (
    <span
      className={['av', size, faded && 'gone'].filter(Boolean).join(' ')}
      style={{ '--c': look.bg } as CSSProperties}
      title={title}
      role={title ? 'img' : undefined}
      aria-label={title}
    >
      <Mascot kind={look.kind} face={look.face} mood={mood} />
    </span>
  )
}
