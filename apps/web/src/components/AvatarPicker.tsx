import { AVATAR_ANIMALS, AVATAR_COLORS, firstFreeAvatar, sameAvatar, type AvatarChoice, type AvatarColor } from '@squadsplit/shared'
import type { CSSProperties } from 'react'
import { ApiError } from '../api'
import { Avatar, animalLabel, colorLabel } from '../design/Avatar'

const COLORS = Object.keys(AVATAR_COLORS) as AvatarColor[]

export const AVATAR_TAKEN_TEXT = 'Someone in this group already looks like that — pick another.'

/** The API's 409 avatar_taken in plain words; any other error is passed through for ErrorNote. */
export const avatarErrorOf = (error: unknown): unknown =>
  error instanceof ApiError && error.code === 'avatar_taken' ? new Error(AVATAR_TAKEN_TEXT) : error

/**
 * Pick an animal and a colour for yourself in a group. `taken` are the other active members' looks:
 * those combinations are greyed out. Picking an animal keeps the colour if that combination is free,
 * otherwise it moves to the animal's next free colour, so the value is never a taken look.
 */
export function AvatarPicker({
  value,
  taken,
  onChange,
}: {
  value: AvatarChoice
  taken: AvatarChoice[]
  onChange: (avatar: AvatarChoice) => void
}) {
  const isTaken = (a: AvatarChoice) => taken.some((t) => sameAvatar(t, a))
  return (
    <div className="picker">
      <div className="picker-animals" role="group" aria-label="Animal">
        {AVATAR_ANIMALS.map((animal) => {
          const allTaken = COLORS.every((color) => isTaken({ animal, color }))
          // What picking it would give you, so each tile shows the look you'd get.
          const pick = firstFreeAvatar({ animal, color: value.color }, taken)
          const label = animalLabel(animal)
          return (
            <button
              key={animal}
              type="button"
              className="pick"
              aria-pressed={value.animal === animal}
              aria-label={allTaken ? `${label}, taken` : label}
              title={allTaken ? 'Taken' : label}
              disabled={allTaken}
              onClick={() => onChange(pick)}
            >
              <Avatar avatar={pick} />
              <span aria-hidden="true">{label}</span>
            </button>
          )
        })}
      </div>
      <div className="swatches" role="group" aria-label="Colour">
        {COLORS.map((color) => {
          const gone = isTaken({ animal: value.animal, color })
          const label = colorLabel(color)
          return (
            <button
              key={color}
              type="button"
              className="swatch"
              style={{ '--c': AVATAR_COLORS[color] } as CSSProperties}
              aria-pressed={value.color === color}
              aria-label={gone ? `${label}, taken` : label}
              title={gone ? 'Taken' : label}
              disabled={gone}
              onClick={() => onChange({ animal: value.animal, color })}
            />
          )
        })}
      </div>
    </div>
  )
}

/** How you'll appear in the group: your look next to your name. */
export function YouPreview({ avatar, name }: { avatar: AvatarChoice; name: string }) {
  return (
    <div className="you-preview">
      <Avatar avatar={avatar} size="lg" title={`You: ${animalLabel(avatar.animal)} on ${colorLabel(avatar.color)}`} />
      <b>{name}</b>
    </div>
  )
}
