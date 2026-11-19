import { formatMoney, settlementCap, type BalancesDTO, type SettlementDTO, type Transfer } from '@squadsplit/shared'
import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { ApiError, useApi } from '../api'
import { Avatar } from '../design/Avatar'
import { UiIcon } from '../design/icons'
import { useExitTransition } from '../design/useExitTransition'
import { useGroupMutation, type People } from '../groupData'
import { ErrorNote } from './ErrorNote'
import { NotJoinedTag } from './NotJoinedTag'
import { SettleForm, type SettleDirection, type SettlementInput } from './SettleForm'

/**
 * The simplified debts. On one where you are the debtor, "Mark paid" opens a small form, pre-filled with
 * what you can pay that creditor now, to settle any amount with any creditor. On one where someone who hasn't
 * joined owes you, "Mark paid" records what they paid you (they can't record it themselves).
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
  /** The other person on the transfer whose "Mark paid" opened the form, or null while it is closed. */
  const [formFor, setFormFor] = useState<{ direction: SettleDirection; other: string } | null>(null)
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

  function open(direction: SettleDirection, other: string, e: MouseEvent<HTMLElement>) {
    settle.reset()
    opener.current = e.currentTarget
    setFormFor({ direction, other })
  }

  // The API's exceeds_debt message counts raw cents; say it in money, from the (refetched) balances.
  const friendlyError = (error: Error, input: SettlementInput | undefined) => {
    if (!(error instanceof ApiError && error.code === 'exceeds_debt' && input)) return error
    if (input.fromUserId && input.fromUserId !== me) {
      const owed = settlementCap(balances.balances, 0, input.fromUserId, me)
      return new Error(`${people.name(input.fromUserId)} owes you at most ${formatMoney(owed, currency)} right now.`)
    }
    return new Error(`You can mark at most ${formatMoney(cap(input.toUserId), currency)} as paid right now.`)
  }
  const owedByPlaceholder = (fromUserId: string) => settlementCap(balances.balances, 0, fromUserId, me)
  const tagged = (userId: string) => (people.isPlaceholder(userId) ? <NotJoinedTag /> : null)

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
            {tagged(t.fromUserId)}
            {tagged(t.toUserId)}
          </div>
        </div>
        <div className="amt-r">{formatMoney(t.amountCents, currency)}</div>
        {t.fromUserId === me && !people.isFormer(t.toUserId) && (
          <button
            className="btn small primary"
            disabled={amount < 1 || settle.isPending}
            aria-expanded={formFor?.direction === 'paid' && formFor.other === t.toUserId}
            title={amount < 1 ? 'Waiting on a confirmation' : undefined}
            onClick={(e) => open('paid', t.toUserId, e)}
          >
            Mark paid
          </button>
        )}
        {t.toUserId === me && people.isPlaceholder(t.fromUserId) && (
          <button
            className="btn small primary"
            disabled={owedByPlaceholder(t.fromUserId) < 1 || settle.isPending}
            aria-expanded={formFor?.direction === 'received' && formFor.other === t.fromUserId}
            onClick={(e) => open('received', t.fromUserId, e)}
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
          key={`${form.shown.direction}:${form.shown.other}`}
          leaving={form.leaving}
          balances={balances.balances}
          pendingOutgoingCents={pendingOutgoing}
          suggestions={balances.suggestions}
          me={me}
          direction={form.shown.direction}
          initialPayee={form.shown.other}
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
      {settle.isError && <ErrorNote error={friendlyError(settle.error, settle.variables)} />}
    </>
  )
}
