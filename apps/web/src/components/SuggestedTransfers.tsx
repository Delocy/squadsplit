import { formatMoney, settlementCap, type BalancesDTO, type SettlementDTO, type Transfer } from '@squadsplit/shared'
import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { ApiError, useApi } from '../api'
import { Avatar } from '../design/Avatar'
import { UiIcon } from '../design/icons'
import { useExitTransition } from '../design/useExitTransition'
import { useGroupMutation, type People } from '../groupData'
import { ErrorNote } from './ErrorNote'
import { SettleForm, type SettlementInput } from './SettleForm'

/**
 * The simplified debts. On one where you are the debtor, "Mark paid" opens a small form, pre-filled with
 * what you can pay that creditor now, to settle any amount with any creditor.
 */
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
  const settle = useGroupMutation(groupId, (t: SettlementInput) => api.post<SettlementDTO>(`/groups/${groupId}/settlements`, t))
  /** The creditor whose "Mark paid" opened the form, or null while it is closed. */
  const [formFor, setFormFor] = useState<string | null>(null)
  // The form slides out when it closes; then the "Mark paid" button that opened it gets focus back.
  const form = useExitTransition(formFor)
  const opener = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (form.shown !== null || !opener.current) return
    opener.current.focus()
    opener.current = null
  }, [form.shown])

  const pendingOutgoing = pending.filter((s) => s.fromUserId === me).reduce((sum, s) => sum + s.amountCents, 0)
  const cap = (toUserId: string) => settlementCap(balances.balances, pendingOutgoing, me, toUserId)
  const mine = balances.suggestions.filter((t) => t.fromUserId === me)

  function open(toUserId: string, e: MouseEvent<HTMLElement>) {
    settle.reset()
    opener.current = e.currentTarget
    setFormFor(toUserId)
  }

  // The API's exceeds_debt message counts raw cents; say it in money, from the (refetched) balances.
  const friendlyError = (error: Error, toUserId: string | undefined) =>
    error instanceof ApiError && error.code === 'exceeds_debt' && toUserId
      ? new Error(
          `You can mark at most ${formatMoney(cap(toUserId), currency)} as paid right now.`,
        )
      : error

  const row = (t: Transfer) => {
    const amount = Math.min(t.amountCents, cap(t.toUserId))
    return (
      <li className="row" key={`${t.fromUserId}>${t.toUserId}`}>
        <Avatar avatar={people.avatar(t.fromUserId)} size="sm" faded={people.isFormer(t.fromUserId)} />
        <span className="arrow">
          <UiIcon name="arrow" />
        </span>
        <Avatar avatar={people.avatar(t.toUserId)} size="sm" faded={people.isFormer(t.toUserId)} />
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
            aria-expanded={formFor === t.toUserId}
            title={amount < 1 ? 'Waiting on a confirmation' : undefined}
            onClick={(e) => open(t.toUserId, e)}
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
      {form.shown && (
        <SettleForm
          key={form.shown}
          leaving={form.leaving}
          balances={balances.balances}
          pendingOutgoingCents={pendingOutgoing}
          suggestions={mine}
          me={me}
          initialPayee={form.shown}
          people={people}
          currency={currency}
          busy={settle.isPending}
          onSubmit={(input) => settle.mutate(input, { onSuccess: () => setFormFor(null) })}
          onCancel={() => {
            settle.reset()
            setFormFor(null)
          }}
        />
      )}
      {settle.isError && <ErrorNote error={friendlyError(settle.error, settle.variables?.toUserId)} />}
    </>
  )
}
