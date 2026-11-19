import { Mascot } from '../design/icons'

/** Shown instead of the app when the Clerk key is missing, so the app can still be previewed. */
export function Setup() {
  return (
    <main className="wrap narrow landing">
      <div className="hero-mark bob">
        <Mascot kind="bunny" face="#ffffff" mood="nervous" />
      </div>
      <h2 className="hero">Almost ready</h2>
      <section className="card setup">
        <p>SquadSplit needs a Clerk publishable key before anyone can sign in.</p>
        <ol>
          <li>
            Copy <code>apps/web/.env.example</code> to <code>apps/web/.env.local</code>.
          </li>
          <li>
            Set <code>VITE_CLERK_PUBLISHABLE_KEY</code> to the publishable key from your Clerk dashboard.
          </li>
          <li>Restart the dev server.</li>
        </ol>
      </section>
    </main>
  )
}
