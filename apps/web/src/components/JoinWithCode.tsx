import { INVITE_CODE_ALPHABET, INVITE_CODE_LENGTH } from '@squadsplit/shared'
import { useState, type FormEvent } from 'react'
import { usePageNavigate } from './PageLink'

const INVITE_CODE = new RegExp(`^[${INVITE_CODE_ALPHABET}]{${INVITE_CODE_LENGTH}}$`)
/** The look-alike characters codes leave out. */
const NEVER_IN_CODES = /[O0IL1]/

/** What was typed or pasted, tidied up: a whole invite link gives its code; spaces and dashes go; upper case. */
function tidy(typed: string): string {
  const fromLink = /\/join\/([^/?#\s]+)/i.exec(typed)?.[1]
  return (fromLink ?? typed).replace(/[\s-]+/g, '').toUpperCase()
}

/** Why a tidied code can't be one, or null when it can. */
function codeProblem(code: string): string | null {
  if (INVITE_CODE.test(code)) return null
  if (code.length === INVITE_CODE_LENGTH && NEVER_IN_CODES.test(code)) return "Codes don't use O, 0, I, L or 1. Check the letters."
  return `That doesn't look like an invite code. Codes are ${INVITE_CODE_LENGTH} letters and numbers, like ABCD2345.`
}

/**
 * "Got a code from a friend?": opens `/join/<CODE>`, which previews the group before joining. It takes the code as
 * read aloud ("ABCD 2345") or a whole pasted invite link. The Join page is told it was typed, so a code that matches
 * no group isn't called a dead link.
 */
export function JoinWithCode({ placeholder = 'Got a code? e.g. ABCD2345' }: { placeholder?: string }) {
  const navigate = usePageNavigate()
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string | null>(null)

  function submit(e: FormEvent) {
    e.preventDefault()
    const code = tidy(typed)
    const problem = codeProblem(code)
    if (problem) setError(problem)
    else navigate(`/join/${code}`, { state: { typed: true } })
  }

  return (
    <form aria-label="Join with a code" onSubmit={submit} noValidate style={{ width: '100%', maxWidth: 380 }}>
      <div className="invite-link code-join">
        <input
          type="text"
          aria-label="Invite code"
          placeholder={placeholder}
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value)
            setError(null)
          }}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" className="btn">
          Join
        </button>
      </div>
      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}
