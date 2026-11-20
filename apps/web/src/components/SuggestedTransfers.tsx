import { formatMoney, settlementCap, type BalancesDTO, type FunDTO, type SettlementDTO, type Transfer } from '@squadsplit/shared'
import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { ApiError, useApi } from '../api'
import { Avatar } from '../design/Avatar'
import { UiIcon } from '../design/icons'
import { balanceMood } from '../design/mood'
import { useExitTransition } from '../design/useExitTransition'
import { useGroupMutation, type People } from '../groupData'
import { ErrorNote } from './ErrorNote'
import { NotJoinedTag } from './NotJoinedTag'
import { SettleForm, type SettleDirection, type SettlementInput } from './SettleForm'
import { useSettleMoment } from './SettleMoment'

/** Names up to this long never truncate in a transfer's line. */
const SHORT_NAME = 8

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
  fun,
}: {
  groupId: string
  balances: BalancesDTO
  pending: SettlementDTO[]
  me: string
  people: People
  currency: string
  /** The group's titles, to tell when a payback earns the payer the Good Egg sticker. */
  fun?: FunDTO
}) {
  const api = useApi()
  // A payment with someone who hasn't joined counts straight away (it comes back confirmed): it is celebrated as soon
  // as the API says so, before the group is refetched (callbacks passed to mutate wait for that).
  const counted = useSettleMoment({ people, currency, fun })
  const settle = useGroupMutation(groupId, async (t: SettlementInput) => {
    const s = await api.post<SettlementDTO>(`/groups/${groupId}/settlements`, t)
    if (s.status === 'confirmed') {
      // The moment takes the form's place and focus; the Mark paid button that opened it doesn't take focus back.
      opener.current = null
      setFormFor(null)
      counted.celebrate(s, { takeFocus: true })
    }
    return s
  })
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
  const mood = (userId: string) => balanceMood(balances.balances[userId] ?? 0)

  /** Whether `t` is the transfer whose "Mark paid" opens the form for `f.other` in `f.direction`. */
  const isRowFor = (t: Transfer, f: { direction: SettleDirection; other: string }) =>
    f.direction === 'paid' ? t.fromUserId === me && t.toUserId === f.other : t.toUserId === me && t.fromUserId === f.other
  // The suggestions can change under an open form (someone adds an expense). If its row goes, the form goes too,
  // saying why, rather than vanishing or recording a payment the list no longer suggests.
  const [moved, setMoved] = useState(false)
  // (Not while a payment from it is saving or just saved: that is what took its row away.)
  const rowGone = formFor !== null && settle.isIdle && !balances.suggestions.some((t) => isRowFor(t, formFor))
  useEffect(() => {
    if (!rowGone) return
    opener.current = null
    setFormFor(null)
    setMoved(true)
  }, [rowGone])

  function open(direction: SettleDirection, other: string, e: MouseEvent<HTMLElement>) {
    setMoved(false)
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
  // Each name truncates on its own, so a long one never pushes the other out of sight; a short one ("You", "Bob")
  // never truncates at all.
  const name = (userId: string) => {
    const label = people.you(userId)
    return (
      <span className={label.length <= SHORT_NAME ? 'nm short' : 'nm'} title={label}>
        {label}
      </span>
    )
  }

  // The form opens inside the row whose "Mark paid" was tapped, right under it.
  const settleForm = form.shown && (
    <div className="settle-in-row">
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
      {settle.isError && <ErrorNote error={friendlyError(settle.error, settle.variables)} />}
    </div>
  )

  /** Whether the open form belongs under this transfer: its "Mark paid" opened it. */
  const formIsFor = (t: Transfer) => form.shown !== null && isRowFor(t, form.shown)

  const row = (t: Transfer) => {
    const amount = Math.min(t.amountCents, cap(t.toUserId))
    return (
      <li className="row transfer" key={`${t.fromUserId}>${t.toUserId}`}>
        <Avatar avatar={people.avatar(t.fromUserId)} size="sm" faded={people.isFormer(t.fromUserId)} {...mood(t.fromUserId)} />
        <span className="arrow">
          <UiIcon name="arrow" />
        </span>
        <Avatar avatar={people.avatar(t.toUserId)} size="sm" faded={people.isFormer(t.toUserId)} {...mood(t.toUserId)} />
        <div className="grow">
          <div className="t">
            {name(t.fromUserId)}
            <span className="to"> → </span>
            {name(t.toUserId)}
          </div>
          {(people.isPlaceholder(t.fromUserId) || people.isPlaceholder(t.toUserId)) && (
            <div className="tags">
              {tagged(t.fromUserId)}
              {tagged(t.toUserId)}
            </div>
          )}
        </div>
        <div className="row-end">
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
        </div>
        {formIsFor(t) && settleForm}
      </li>
    )
  }

  return (
    <>
      {counted.moment}
      <ul className="list">
        {balances.suggestions.length ? (
          balances.suggestions.map(row)
        ) : (
          <li className="empty">Everyone is settled up.</li>
        )}
      </ul>
      {moved && (
        <p className="s" role="status">
          Settle up changed while you had that open. Have another look before you mark it paid.
        </p>
      )}
    </>
  )
}
