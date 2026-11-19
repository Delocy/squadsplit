import { AVATAR_ANIMALS, AVATAR_COLORS, type AvatarAnimal, type AvatarChoice, type AvatarColor } from '@squadsplit/shared'
import type { CSSProperties } from 'react'
import { Mascot, SparkleArt, SweatDropArt, type Kind, type Mood } from './icons'
import type { SweatDrops } from './mood'

/** Each avatar animal's face colour. The logo pup is not an avatar. */
const FACES: Record<AvatarAnimal, string> = {
  bunny: '#ffffff',
  bear: '#f3d2b3',
  panda: '#ffffff',
  kitty: '#ffe8a3',
  fox: '#f8a86a',
  hamster: '#f5c590',
  penguin: '#ffffff',
  koala: '#c3c7d1',
}
// Each animal's signature background on the landing page, in AVATAR_ANIMALS order.
const SIGNATURE = ['#ffc8dd', '#bde0fe', '#cdb4ff', '#b8f2d8', '#ffd8b5', '#fff1a8', '#c5f0f5', '#e6d6ff']

export interface AvatarLook {
  kind: Kind
  face: string
  bg: string
}

/** How an avatar choice is drawn: the animal, its face colour, and the background. */
export const lookOf = (avatar: AvatarChoice): AvatarLook => ({
  kind: avatar.animal,
  face: FACES[avatar.animal],
  bg: AVATAR_COLORS[avatar.color],
})

const capitalised = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
/** "Fox", for buttons and labels. */
export const animalLabel = (animal: AvatarAnimal) => capitalised(animal)
/** "Peach", for buttons and labels. */
export const colorLabel = (color: AvatarColor) => capitalised(color)

/** The eight avatar animals on their signature colours, for the landing page. */
export const SQUAD: AvatarLook[] = AVATAR_ANIMALS.map((animal, i) => ({ kind: animal, face: FACES[animal], bg: SIGNATURE[i]! }))

/** Drops of sweat around an avatar or mascot (in an element positioned for them: `.avw` or `.buddy-w`). */
export function Sweat({ drops }: { drops: SweatDrops }) {
  return (
    <>
      {Array.from({ length: drops }, (_, i) => (
        <i className={`sweat s${i}`} key={i}>
          <SweatDropArt />
        </i>
      ))}
    </>
  )
}

/**
 * A member's animal on their colour. `mood` sets the face; `sweat` (drops of it) and `sparkle` add a little overlay
 * around it, usually from `balanceMood` in ./mood: `<Avatar avatar={a} {...balanceMood(net)} />`.
 */
export function Avatar({
  avatar,
  size,
  mood = 'calm',
  title,
  faded = false,
  sweat = 0,
  sparkle = false,
}: {
  avatar: AvatarChoice
  size?: 'sm' | 'lg' | 'xl'
  mood?: Mood
  title?: string
  /** Greyed out, for someone who has left the group. */
  faded?: boolean
  /** Drops of nervous sweat: more for a bigger debt. */
  sweat?: SweatDrops
  /** A little sparkle, for someone who is owed. Not shown on a sweating avatar. */
  sparkle?: boolean
}) {
  const look = lookOf(avatar)
  const face = (
    <span
      className={['av', size, faded && 'gone'].filter(Boolean).join(' ')}
      style={{ '--c': look.bg } as CSSProperties}
      title={title}
      role={title ? 'img' : undefined}
      aria-label={title}
      data-mood={mood}
    >
      <Mascot kind={look.kind} face={look.face} mood={mood} />
    </span>
  )
  if (!sweat && !sparkle) return face
  return (
    <span className={size ? `avw ${size}` : 'avw'}>
      {face}
      <Sweat drops={sweat} />
      {!sweat && sparkle && (
        <i className="glint">
          <SparkleArt />
        </i>
      )}
    </span>
  )
}
