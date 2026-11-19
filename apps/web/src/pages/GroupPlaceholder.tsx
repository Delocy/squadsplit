import { Link } from 'react-router'

/** Stands in for the group screens until they are built. */
export function GroupPlaceholder() {
  return (
    <main className="narrow page">
      <section className="card">
        <h3>This group's page is on its way</h3>
        <p className="empty">Balances, expenses and settling up will live here.</p>
        <Link to="/groups" className="btn small">
          Back to your groups
        </Link>
      </section>
    </main>
  )
}
