import { INVITE_CODE_ALPHABET, INVITE_CODE_LENGTH } from '@squadsplit/shared'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'

const INVITE_CODE = new RegExp(`^[${INVITE_CODE_ALPHABET}]{${INVITE_CODE_LENGTH}}$`)

/** A typed invite code, tidied up, or null when it can't be one. */
function normaliseInviteCode(typed: string): string | null {
  const code = typed.trim().toUpperCase()
  return INVITE_CODE.test(code) ? code : null
}

/** "Got a code from a friend?": opens `/join/<CODE>`, which previews the group before joining. */
export function JoinWithCode() {
  const navigate = useNavigate()
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string | null>(null)

  function submit(e: FormEvent) {
    e.preventDefault()
    const code = normaliseInviteCode(typed)
    if (code) navigate(`/join/${code}`)
    else setError(`That doesn't look like an invite code. Codes are ${INVITE_CODE_LENGTH} letters and numbers, like ABCD2345.`)
  }

  return (
    <form aria-label="Join with a code" onSubmit={submit} noValidate style={{ width: '100%', maxWidth: 380 }}>
      <div className="invite-link">
        <input
          type="text"
          aria-label="Invite code"
          placeholder="Got a code? e.g. ABCD2345"
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
