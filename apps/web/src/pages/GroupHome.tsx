import { useAuth } from '@clerk/react'
import { formatMoney } from '@squadsplit/shared'
import { Link, Outlet, useParams } from 'react-router'
import { BalanceCard } from '../components/BalanceCard'
import { ErrorNote } from '../components/ErrorNote'
import { Feed } from '../components/Feed'
import { GroupUnavailable } from '../components/GroupUnavailable'
import { Leaderboard } from '../components/Leaderboard'
import { PendingActions } from '../components/PendingActions'
import { SuggestedTransfers } from '../components/SuggestedTransfers'
import { UiIcon } from '../design/icons'
import { peopleOf, useBalances, useExpenses, useFeed, useFun, useGroup, usePendingSettlements } from '../groupData'

/** `/groups/:id`: your balance, settling up, the activity feed, the leaderboard and the wheel. The expense dialog opens over it. */
export function GroupHome() {
  const id = useParams().id ?? ''
  const me = useAuth().userId ?? ''
  const group = useGroup(id)
  const balances = useBalances(id)
  const expenses = useExpenses(id)
  const pending = usePendingSettlements(id)
  const fun = useFun(id)
  const feed = useFeed(id)

  if (group.isPending) {
    return (
      <main className="page">
        <p className="empty">Loading the group…</p>
      </main>
    )
  }
  if (group.isError) return <GroupUnavailable error={group.error} />

  const g = group.data
  const people = peopleOf(g, me)
  const money = (cents: number) => formatMoney(cents, g.currency)
  const all = expenses.data ?? []
  const totalSpent = all.reduce((t, e) => t + e.amountCents, 0)
  const myShare = all.reduce((t, e) => t + (e.shares.find((s) => s.userId === me)?.amountCents ?? 0), 0)
  const myPaid = all.filter((e) => e.paidBy === me).reduce((t, e) => t + e.amountCents, 0)
  const needMe = (pending.data ?? []).filter((s) => s.toUserId === me).length
  const addExpense = `/groups/${id}/expenses/new`
  const wheel = `/groups/${id}/wheel`

  return (
    <main className="page">
      <div className="summary">
        {balances.data ? (
          <BalanceCard cents={balances.data.balances[me] ?? 0} currency={g.currency} userId={me} seed={feed.data?.length ?? 0} />
        ) : (
          <section className="card balance even" aria-label="Your balance">
            {balances.isError ? <ErrorNote error={balances.error} /> : <p className="empty">Working out balances…</p>}
          </section>
        )}
        <section className="card" aria-label="Group stats">
          <div className="stats">
            <div className="stat">
              <div className="k">Group spend</div>
              <div className="v">{money(totalSpent)}</div>
            </div>
            <div className="stat">
              <div className="k">Your share</div>
              <div className="v">{money(myShare)}</div>
            </div>
            <div className="stat">
              <div className="k">You paid</div>
              <div className="v">{money(myPaid)}</div>
            </div>
          </div>
          <div className="quick">
            <Link to={addExpense} className="btn primary add-desktop">
              <UiIcon name="plus" />
              Add expense
            </Link>
            <Link to={wheel} className="btn">
              <UiIcon name="wheel" />
              Who pays next?
            </Link>
            <Link to={`/groups/${id}/settings`} className="btn ghost">
              Group settings
            </Link>
          </div>
        </section>
      </div>

      <div className="main">
        <div className="col">
          <section className="card" aria-labelledby="settle-h">
            <h3 id="settle-h">
              <UiIcon name="heart" />
              Settle up
              {needMe > 0 && (
                <span className="count" aria-label={`${needMe} needs your action`}>
                  {needMe}
                </span>
              )}
            </h3>
            <PendingActions groupId={id} pending={pending.data ?? []} me={me} people={people} currency={g.currency} />
            {balances.data && (
              <SuggestedTransfers
                groupId={id}
                balances={balances.data}
                pending={pending.data ?? []}
                me={me}
                people={people}
                currency={g.currency}
              />
            )}
          </section>
          <Feed groupId={id} items={feed.data} me={me} ownerId={g.ownerId} people={people} currency={g.currency} />
        </div>

        <div className="col">
          <Leaderboard fun={fun.data} people={people} currency={g.currency} />
          <section className="card wheel-card" aria-labelledby="wheel-h">
            <h3 id="wheel-h">
              <UiIcon name="wheel" />
              Who pays next?
            </h3>
            <p className="s">Can't decide who gets the next round? Spin the wheel. People who owe more are more likely to be picked.</p>
            <Link to={wheel} className="btn">
              <UiIcon name="star" />
              Spin the wheel
            </Link>
          </section>
        </div>
      </div>

      <Link to={addExpense} className="btn primary fab">
        <UiIcon name="plus" />
        Add expense
      </Link>
      <Outlet />
    </main>
  )
}
