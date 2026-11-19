import { formatMoney, settlementCap } from '@squadsplit/shared'
import { useState, type FormEvent } from 'react'
import { BusyLabel } from '../design/Busy'
import { centsToInput, parseAmount } from '../expenseDraft'
import type { People } from '../groupData'

export interface SettlementInput {
  toUserId: string
  amountCents: number
}

/**
 * "Mark paid": who you paid and how much, from 1¢ up to what you can settle with them right now
 * (see settlementCap). Opens on a suggested transfer and starts from it; any creditor can be picked.
 */
export function SettleForm({
  balances,
  pendingOutgoingCents,
  suggestions,
  me,
  initialPayee,
  people,
  currency,
  busy,
  onSubmit,
  onCancel,
}: {
  balances: Record<string, number>
  /** Everything you have marked paid that is still waiting for confirmation. */
  pendingOutgoingCents: number
  /** Your suggested transfers, to pre-fill the amount for a creditor. */
  suggestions: SettlementInput[]
  me: string
  initialPayee: string
  people: People
  currency: string
  busy: boolean
  onSubmit: (input: SettlementInput) => void
  onCancel: () => void
}) {
  const cap = (payee: string) => settlementCap(balances, pendingOutgoingCents, me, payee)
  const prefill = (payee: string) => {
    const suggested = suggestions.find((s) => s.toUserId === payee)?.amountCents ?? Infinity
    return centsToInput(Math.min(suggested, cap(payee)))
  }
  const creditors = people.active.filter((m) => m.userId !== me && (balances[m.userId] ?? 0) > 0)

  const [payee, setPayee] = useState(initialPayee)
  const [amount, setAmount] = useState(() => prefill(initialPayee))
  const [error, setError] = useState<string | null>(null)

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
    if (cents > max) return setError(`You can mark at most ${formatMoney(max, currency)} as paid to ${people.name(payee)} right now.`)
    setError(null)
    onSubmit({ toUserId: payee, amountCents: cents })
  }

  return (
    <form className="settle-form" aria-label="Mark a payment" onSubmit={submit}>
      <div className="settle-fields">
        <div>
          <label className="f" htmlFor="settle-payee">
            Paid to
          </label>
          <select id="settle-payee" value={payee} onChange={(e) => choosePayee(e.target.value)}>
            {creditors.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.displayName}
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
        <button type="submit" className="btn small primary" disabled={busy}>
          <BusyLabel busy={busy} label="Saving…">
            Submit
          </BusyLabel>
        </button>
      </div>
    </form>
  )
}
