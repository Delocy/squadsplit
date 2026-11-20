import { ApiError, isRetryable } from '../api'
import { Mascot } from '../design/icons'

export const OFFLINE = "Can't reach SquadSplit. Check your signal."

/** What went wrong, in plain words: the network, or the API's own message. */
export function errorText(error: unknown): string {
  if (error instanceof ApiError && error.code === 'network') return OFFLINE
  return error instanceof Error ? error.message : 'Something went wrong.'
}

/**
 * A page or card that couldn't load: the shivering mascot, what went wrong, and Try again when trying again could
 * help (the network or the server, not a 4xx).
 */
export function ErrorCard({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <section className="card join error-card" role="alert">
      <div className="hero-mark shiver">
        <Mascot kind="kitty" face="#ffe8a3" mood="nervous" />
      </div>
      <p>{errorText(error)}</p>
      {isRetryable(error) && (
        <button type="button" className="btn primary" onClick={onRetry}>
          Try again
        </button>
      )}
    </section>
  )
}
