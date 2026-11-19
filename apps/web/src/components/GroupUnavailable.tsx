import { ApiError } from '../api'
import { Mascot } from '../design/icons'
import { ErrorCard } from './ErrorCard'
import { PageLink } from './PageLink'

/**
 * Shown instead of a group page when the group can't be loaded. A 404 means it doesn't exist or you're not in it:
 * an invite link gets you in. Anything else (the network, the server) can be tried again.
 */
export function GroupUnavailable({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const missing = error instanceof ApiError && error.status === 404
  if (!missing) {
    return (
      <main className="narrow page">
        <ErrorCard error={error} onRetry={onRetry} />
      </main>
    )
  }
  return (
    <main className="narrow page">
      <section className="card join">
        <div className="hero-mark shiver">
          <Mascot kind="kitty" face="#ffe8a3" mood="nervous" />
        </div>
        <p>We can't find this group. It may not exist, or you're not in it.</p>
        <p className="s">Got an invite link? Open it to join.</p>
        <PageLink to="/groups" className="btn small">
          Back to your groups
        </PageLink>
      </section>
    </main>
  )
}
