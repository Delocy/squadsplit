import { formatMoney } from '@squadsplit/shared'
import { Link, Outlet, useParams } from 'react-router'
import { BalanceCard } from '../components/BalanceCard'
import { ErrorNote } from '../components/ErrorNote'
import { PageLink } from '../components/PageLink'
import { GroupHomeSkeleton } from '../components/Skeletons'
import { Feed } from '../components/Feed'
import { GroupUnavailable } from '../components/GroupUnavailable'
import { Leaderboard } from '../components/Leaderboard'
import { SquadNap } from '../components/SquadNap'
import { PendingActions } from '../components/PendingActions'
import { SuggestedTransfers } from '../components/SuggestedTransfers'
import { WheelCard } from '../components/WheelCard'
import { UiIcon } from '../design/icons'
import { peopleOf, useBalances, useExpenses, useFeed, useFun, useGroup, usePendingSettlements } from '../groupData'
import { useMyId } from '../guest/GroupAccess'

/** `/groups/:id`: your balance, settling up, the activity feed, the leaderboard and the wheel. The expense dialog opens over it. */
export function GroupHome() {
  const id = useParams().id ?? ''
  const me = useMyId()
  const group = useGroup(id)
  const balances = useBalances(id)
  const expenses = useExpenses(id)
  const pending = usePendingSettlements(id)
  const fun = useFun(id)
  const feed = useFeed(id)

  if (group.isError) return <GroupUnavailable error={group.error} />
  // The page waits for everything in its first screens and then appears at once: cards filling in one by one would
  // push each other down. Only the leaderboard (side column, below the fold on a phone) fills in on its own.
  if (group.isPending || [balances, expenses, pending, feed].some((q) => q.isPending)) return <GroupHomeSkeleton />

  const g = group.data
  const people = peopleOf(g, me)
  const money = (cents: number) => formatMoney(cents, g.currency)
  // Without the expenses (they failed to load) the stats are unknown, not zero.
  const stat = (cents: number) => (expenses.data ? money(cents) : '—')
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
          <BalanceCard
            cents={balances.data.balances[me] ?? 0}
            currency={g.currency}
            avatar={people.avatar(me)}
            seed={feed.data?.length ?? 0}
            squad={people.active
              .filter((m) => m.userId !== me)
              .map((m) => ({ userId: m.userId, name: m.displayName, avatar: m.avatar, cents: balances.data.balances[m.userId] ?? 0 }))}
          />
        ) : (
          <section className="card balance even" aria-label="Your balance">
            <ErrorNote error={balances.error} />
          </section>
        )}
        <section className="card" aria-label="Group stats">
          <div className="stats">
            <div className="stat">
              <div className="k">Group spend</div>
              <div className="v">{stat(totalSpent)}</div>
            </div>
            <div className="stat">
              <div className="k">Your share</div>
              <div className="v">{stat(myShare)}</div>
            </div>
            <div className="stat">
              <div className="k">You paid</div>
              <div className="v">{stat(myPaid)}</div>
            </div>
          </div>
          <div className="quick">
            <Link to={addExpense} preventScrollReset className="btn primary add-desktop">
              <UiIcon name="plus" />
              Add expense
            </Link>
            <PageLink to={wheel} className="btn">
              <UiIcon name="wheel" />
              Who pays next?
            </PageLink>
            <PageLink to={`/groups/${id}/settings`} className="btn ghost">
              Group settings
            </PageLink>
          </div>
        </section>
      </div>

      <div className="main">
        <div className="col">
          {expenses.data?.length === 0 && <SquadNap people={people} addExpense={addExpense} />}
          <section className="card" aria-labelledby="settle-h">
            <h3 id="settle-h" tabIndex={-1}>
              <UiIcon name="heart" />
              Settle up
              {needMe > 0 && (
                <span className="count" aria-label={`${needMe} needs your action`}>
                  {needMe}
                </span>
              )}
            </h3>
            <PendingActions
              groupId={id}
              pending={pending.data ?? []}
              me={me}
              people={people}
              currency={g.currency}
              fun={fun.data}
              feed={feed.data}
            />
            {balances.data && (
              <SuggestedTransfers
                groupId={id}
                balances={balances.data}
                pending={pending.data ?? []}
                me={me}
                people={people}
                currency={g.currency}
                fun={fun.data}
              />
            )}
          </section>
          <Feed
            groupId={id}
            items={feed.data}
            error={feed.error}
            onRetry={() => void feed.refetch()}
            me={me}
            ownerId={g.ownerId}
            people={people}
            currency={g.currency}
          />
        </div>

        <div className="col">
          <Leaderboard fun={fun.data} people={people} currency={g.currency} />
          <WheelCard groupId={id} me={me} people={people} balances={balances.data?.balances} compact>
            <PageLink to={wheel} className="btn small ghost recent-spins">
              <UiIcon name="clock" />
              Recent spins
            </PageLink>
          </WheelCard>
        </div>
      </div>

      <Link to={addExpense} preventScrollReset className="btn primary fab">
        <UiIcon name="plus" />
        Add expense
      </Link>
      <Outlet />
    </main>
  )
}
