import { formatMoney, type BalancesDTO, type SettlementDTO, type Transfer } from '@squadsplit/shared'
import { ApiError, useApi } from '../api'
import { Avatar } from '../design/Avatar'
import { UiIcon } from '../design/icons'
import { useGroupMutation, type People } from '../groupData'
import { ErrorNote } from './ErrorNote'

/**
 * What `me` may newly settle with `to` right now, mirroring the API's cap:
 * min(my debt, their credit), minus my settlements still waiting for confirmation.
 */
export function settleableAmount(balances: Record<string, number>, pending: SettlementDTO[], me: string, to: string): number {
  const waiting = pending.filter((s) => s.fromUserId === me).reduce((sum, s) => sum + s.amountCents, 0)
  return Math.max(0, Math.min(-(balances[me] ?? 0), balances[to] ?? 0) - waiting)
}

/** The simplified debts. On one where you are the debtor, "Mark paid" starts a settlement for what you can pay now. */
export function SuggestedTransfers({
  groupId,
  balances,
  pending,
  me,
  people,
  currency,
}: {
  groupId: string
  balances: BalancesDTO
  pending: SettlementDTO[]
  me: string
  people: People
  currency: string
}) {
  const api = useApi()
  const settle = useGroupMutation(groupId, (t: { toUserId: string; amountCents: number }) =>
    api.post<SettlementDTO>(`/groups/${groupId}/settlements`, t),
  )

  // The API's exceeds_debt message counts raw cents; say it in money, from the (refetched) balances.
  const friendlyError = (error: Error, toUserId: string | undefined) =>
    error instanceof ApiError && error.code === 'exceeds_debt' && toUserId
      ? new Error(
          `You can mark at most ${formatMoney(settleableAmount(balances.balances, pending, me, toUserId), currency)} as paid right now.`,
        )
      : error

  const row = (t: Transfer) => {
    const amount = Math.min(t.amountCents, settleableAmount(balances.balances, pending, me, t.toUserId))
    return (
      <li className="row" key={`${t.fromUserId}>${t.toUserId}`}>
        <Avatar userId={t.fromUserId} size="sm" faded={people.isFormer(t.fromUserId)} />
        <span className="arrow">
          <UiIcon name="arrow" />
        </span>
        <Avatar userId={t.toUserId} size="sm" faded={people.isFormer(t.toUserId)} />
        <div className="grow">
          <div className="t">
            {people.you(t.fromUserId)} → {people.you(t.toUserId)}
          </div>
        </div>
        <div className="amt-r">{formatMoney(t.amountCents, currency)}</div>
        {t.fromUserId === me && !people.isFormer(t.toUserId) && (
          <button
            className="btn small primary"
            disabled={amount < 1 || settle.isPending}
            title={amount < 1 ? 'Waiting on a confirmation' : undefined}
            onClick={() => settle.mutate({ toUserId: t.toUserId, amountCents: amount })}
          >
            Mark paid
          </button>
        )}
      </li>
    )
  }

  return (
    <>
      <ul className="list">
        {balances.suggestions.length ? (
          balances.suggestions.map(row)
        ) : (
          <li className="empty">Everyone is settled up.</li>
        )}
      </ul>
      {settle.isError && <ErrorNote error={friendlyError(settle.error, settle.variables?.toUserId)} />}
    </>
  )
}
