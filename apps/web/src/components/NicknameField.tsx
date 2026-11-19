import { Nickname } from '@squadsplit/shared'
import { useState } from 'react'

const MAX_NICKNAME = 24
export const NICKNAME_HINT = 'Keep it to 24 characters, with no emoji.'

/**
 * The text of a nickname field that starts out showing `base` (your profile name, or your current name in
 * the group). `change` is what to send: undefined while it still says `base`, otherwise the trimmed text,
 * where "" clears the nickname. `invalid` is true when the API would reject it.
 */
export function useNicknameDraft(base: string) {
  const [draft, setDraft] = useState<string | null>(null)
  const value = draft ?? base
  const trimmed = value.trim()
  return {
    value,
    setValue: setDraft,
    reset: () => setDraft(null),
    change: draft === null || trimmed === base ? undefined : trimmed,
    invalid: !Nickname.safeParse(value).success,
  }
}

export function NicknameField({
  id,
  value,
  placeholder,
  onChange,
}: {
  id: string
  value: string
  placeholder: string
  onChange: (value: string) => void
}) {
  return (
    <>
      <label className="f" htmlFor={id}>
        What should this group call you?
      </label>
      <input
        id={id}
        type="text"
        maxLength={MAX_NICKNAME}
        autoComplete="nickname"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </>
  )
}
