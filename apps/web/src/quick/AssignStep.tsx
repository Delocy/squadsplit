import { formatMoney } from '@squadsplit/shared'
import type { Dispatch, SetStateAction } from 'react'
import { Avatar } from '../design/Avatar'
import { parseAmount } from '../expenseDraft'
import { Check } from './art'
import { billSoFar, liveTotals, type QuickDraft } from './draft'

type SetDraft = Dispatch<SetStateAction<QuickDraft>>
const money = (cents: number) => formatMoney(cents, 'SGD')
const toggle = (keys: string[], key: string) => (keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key])

/** Step 3: tap who had each dish. Shared dishes are split evenly, and everyone's total shows as you go. */
export function AssignStep({ draft, setDraft }: { draft: QuickDraft; setDraft: SetDraft }) {
  const totals = liveTotals(draft)
  const bill = billSoFar(draft)
  const label = (i: number, name: string) => (i === 0 ? 'You' : name)
  const sum = totals && totals !== 'too_small' ? Object.values(totals.people).reduce((t, p) => t + p.totalCents, 0) : null

  return (
    <>
      <section className="card">
        <ul className="qs-assign">
          {draft.dishes.map((it) => (
            <li className="qs-dish" role="group" aria-label={it.name.trim()} key={it.key}>
              <div className="qs-dish-h">
                <span className="t">{it.name.trim()}</span>
                {it.had.length > 1 && <em>shared by {it.had.length}</em>}
                <b>{money(parseAmount(it.price) ?? 0)}</b>
              </div>
              <div className="qs-who">
                {draft.people.map((p, i) => {
                  const on = it.had.includes(p.key)
                  return (
                    <button
                      type="button"
                      key={p.key}
                      className="qs-tap"
                      aria-pressed={on}
                      onClick={() => setDraft((d) => ({ ...d, dishes: d.dishes.map((x) => (x.key === it.key ? { ...x, had: toggle(x.had, p.key) } : x)) }))}
                    >
                      <Avatar avatar={p.avatar} size="sm" mood={on ? 'happy' : 'calm'} />
                      {label(i, p.name)}
                    </button>
                  )
                })}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="card qs-live" aria-label="Each person, with the charges">
        <span className="lbl">Each person, with {draft.service.on || draft.gst.on ? [draft.service.on && 'service', draft.gst.on && 'GST'].filter(Boolean).join(' + ') : 'no charges'}</span>
        <div className="qs-live-row">
          {draft.people.map((p, i) => (
            <div key={p.key}>
              <Avatar avatar={p.avatar} size="sm" mood="happy" />
              <span>{label(i, p.name)}</span>
              <b>{totals && totals !== 'too_small' ? money(totals.people[p.key]!.totalCents) : '–'}</b>
            </div>
          ))}
        </div>
        {sum !== null && bill ? (
          <div className="qs-check">
            <Check />
            {sum === bill.totalCents ? `Adds up to the bill: ${money(bill.totalCents)}` : `Off by ${money(bill.totalCents - sum)}`}
          </div>
        ) : (
          <div className="qs-check waiting">{totals === 'too_small' ? "A dish is too small to split that many ways." : 'Tap who had each dish to see the totals.'}</div>
        )}
      </section>
    </>
  )
}
