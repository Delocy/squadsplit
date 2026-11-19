import { MAX_GROUP_MEMBERS } from '@squadsplit/shared'
import { useState, type KeyboardEvent } from 'react'
import { MEMBER_NAME_HINT, MEMBER_NAME_MAX, parseMemberName } from '../memberName'

/** Everyone but you: the group holds MAX_GROUP_MEMBERS with you. */
export const MAX_NAMES = MAX_GROUP_MEMBERS - 1

/**
 * The names typed so far and the one still in the box. `withPending()` is every name to send, including a valid
 * name left in the box, or null (and the hint shows) when the box holds one the API would refuse.
 */
export function useNamesDraft() {
  const [names, setNames] = useState<string[]>([])
  const [text, setText] = useState('')
  const [invalid, setInvalid] = useState(false)

  /** Adds what's in the box. False (and the hint shows) when it isn't a name the API takes. */
  function addText(): boolean {
    if (!text.trim()) return true
    const name = parseMemberName(text)
    setInvalid(name === null)
    if (name === null) return false
    // The same name twice is almost always a slip; a second Dave can be added under another name.
    if (!names.includes(name) && names.length < MAX_NAMES) setNames([...names, name])
    setText('')
    return true
  }

  return {
    names,
    text,
    invalid,
    setText: (value: string) => {
      setText(value)
      setInvalid(false)
    },
    addText,
    remove: (name: string) => setNames(names.filter((n) => n !== name)),
    withPending(): string[] | null {
      if (!text.trim()) return names
      const name = parseMemberName(text)
      if (name === null) {
        setInvalid(true)
        return null
      }
      return names.includes(name) ? names : [...names, name].slice(0, MAX_NAMES)
    },
  }
}

/** "Who's in?": the other people in a new group, by name, as removable chips. */
export function NamesField({ id, draft }: { id: string; draft: ReturnType<typeof useNamesDraft> }) {
  const full = draft.names.length >= MAX_NAMES

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    // Enter adds the name instead of creating the group.
    e.preventDefault()
    draft.addText()
  }

  return (
    <>
      <label className="f" htmlFor={id}>
        Who's in?
      </label>
      <p className="s names-help">Add the people you're splitting with. They can claim their name when they join.</p>
      <div className="names-add">
        <input
          id={id}
          type="text"
          maxLength={MEMBER_NAME_MAX}
          autoComplete="off"
          placeholder={full ? '' : 'A friend’s name'}
          value={draft.text}
          disabled={full}
          onChange={(e) => draft.setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button type="button" className="btn" disabled={full || !draft.text.trim()} onClick={draft.addText}>
          Add name
        </button>
      </div>
      <ul className="chips names" aria-label="Who's in">
        {draft.names.map((name) => (
          <li key={name} className="chip name-chip">
            <span>{name}</span>
            <button type="button" className="chip-x" aria-label={`Remove ${name}`} onClick={() => draft.remove(name)}>
              <svg viewBox="0 0 12 12" aria-hidden="true">
                <path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </li>
        ))}
      </ul>
      {full && <p className="s">That's {MAX_GROUP_MEMBERS} with you, the most a group can hold.</p>}
      {draft.invalid && (
        <p className="err" role="alert">
          {MEMBER_NAME_HINT}
        </p>
      )}
    </>
  )
}
