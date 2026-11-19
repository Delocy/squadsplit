import { formatMoney, settlementCap, type Transfer } from '@squadsplit/shared'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { BusyLabel } from '../design/Busy'
import { centsToInput, parseAmount } from '../expenseDraft'
import type { People } from '../groupData'

export interface SettlementInput {
  /** Only for a payment someone who hasn't joined made to you; otherwise you are the payer. */
  fromUserId?: string
  toUserId: string
  amountCents: number
}

/** You paid someone, or (for someone who hasn't joined yet) they paid you. */
export type SettleDirection = 'paid' | 'received'

/**
 * "Mark paid": who you paid and how much, from 1¢ up to what you can settle with them right now
 * (see settlementCap). Opens on a suggested transfer and starts from it; any creditor can be picked.
 * Received: which of the people who haven't joined paid you, up to what they owe you.
 */
export function SettleForm({
  balances,
  pendingOutgoingCents,
  suggestions,
  me,
  direction = 'paid',
  initialPayee,
  people,
  currency,
  busy,
  leaving = false,
  onSubmit,
  onCancel,
}: {
  balances: Record<string, number>
  /** Everything you have marked paid that is still waiting for confirmation. */
  pendingOutgoingCents: number
  /** The suggested transfers, to pre-fill the amount for the other person. */
  suggestions: Transfer[]
  me: string
  direction?: SettleDirection
  /** The other person: who you paid, or who paid you. */
  initialPayee: string
  people: People
  currency: string
  busy: boolean
  /** Animating out after it closed. */
  leaving?: boolean
  onSubmit: (input: SettlementInput) => void
  onCancel: () => void
}) {
  const received = direction === 'received'
  // Someone who hasn't joined never has a payment waiting for confirmation: theirs count straight away.
  const cap = (other: string) =>
    received ? settlementCap(balances, 0, other, me) : settlementCap(balances, pendingOutgoingCents, me, other)
  const prefill = (other: string) => {
    const suggested =
      suggestions.find((s) => (received ? s.fromUserId === other && s.toUserId === me : s.fromUserId === me && s.toUserId === other))
        ?.amountCents ?? Infinity
    return centsToInput(Math.min(suggested, cap(other)))
  }
  const others = received
    ? people.active.filter((m) => m.placeholder && (balances[m.userId] ?? 0) < 0)
    : people.active.filter((m) => m.userId !== me && (balances[m.userId] ?? 0) > 0)

  const [payee, setPayee] = useState(initialPayee)
  const [amount, setAmount] = useState(() => prefill(initialPayee))
  const [error, setError] = useState<string | null>(null)
  const firstField = useRef<HTMLSelectElement>(null)
  useEffect(() => firstField.current?.focus(), [])

  function choosePayee(userId: string) {
    setPayee(userId)
    setAmount(prefill(userId))
    setError(null)
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    const cents = parseAmount(amount)
    const max = cap(payee)
    if (cents === null) return setError('Enter an amount like 12.50.')
    if (cents < 1) return setError(`Enter an amount of at least ${formatMoney(1, currency)}.`)
    if (cents > max) {
      return setError(
        received
          ? `${people.name(payee)} owes you at most ${formatMoney(max, currency)} right now.`
          : `You can mark at most ${formatMoney(max, currency)} as paid to ${people.name(payee)} right now.`,
      )
    }
    setError(null)
    onSubmit(received ? { fromUserId: payee, toUserId: me, amountCents: cents } : { toUserId: payee, amountCents: cents })
  }

  return (
    <form className={leaving ? 'settle-form out' : 'settle-form'} aria-label="Mark a payment" onSubmit={submit}>
      <div className="settle-fields">
        <div>
          <label className="f" htmlFor="settle-payee">
            {received ? 'Who paid you' : 'Paid to'}
          </label>
          <select ref={firstField} id="settle-payee" value={payee} onChange={(e) => choosePayee(e.target.value)}>
            {others.map((m) => (
              <option key={m.userId} value={m.userId}>
                {received ? `${m.displayName} paid me` : m.displayName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="f" htmlFor="settle-amount">
            Amount
          </label>
          <input
            id="settle-amount"
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value)
              setError(null)
            }}
          />
        </div>
      </div>
      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
      <div className="form-f">
        <button type="button" className="btn small ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn small primary" disabled={busy || leaving}>
          <BusyLabel busy={busy} label="Saving…">
            Submit
          </BusyLabel>
        </button>
      </div>
    </form>
  )
}
