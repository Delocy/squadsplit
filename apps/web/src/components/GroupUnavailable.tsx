import { ApiError } from '../api'
import { Mascot } from '../design/icons'
import { ErrorNote } from './ErrorNote'
import { PageLink } from './PageLink'

/** Shown instead of a group page when the group can't be loaded: a 404 means it doesn't exist or you're not in it. */
export function GroupUnavailable({ error }: { error: unknown }) {
  const missing = error instanceof ApiError && error.status === 404
  return (
    <main className="narrow page">
      <section className="card join">
        <div className="hero-mark shiver">
          <Mascot kind="kitty" face="#ffe8a3" mood="nervous" />
        </div>
        {missing ? <p>We can't find this group. It may not exist, or you're not in it.</p> : <ErrorNote error={error} />}
        <PageLink to="/groups" className="btn small">
          Back to your groups
        </PageLink>
      </section>
    </main>
  )
}
