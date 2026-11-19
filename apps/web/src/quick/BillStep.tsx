import { useState, type Dispatch, type SetStateAction } from 'react'
import { ScanReceiptCard } from '../components/ScanReceiptCard'
import { TotalFixup } from '../components/TotalFixup'
import { Avatar } from '../design/Avatar'
import { UiIcon } from '../design/icons'
import { formatMoney, QUICK_SPLIT_MAX_ITEMS } from '@squadsplit/shared'
import { addOtherDish, applyScan, billSoFar, emptyDish, hasTypedDishes, totalCheck, type Charge, type DraftDish, type QuickDraft } from './draft'
import { percent } from './format'
import { centsToInput } from '../expenseDraft'

type SetDraft = Dispatch<SetStateAction<QuickDraft>>
const money = (cents: number) => formatMoney(cents, 'SGD')

/** One charge with its own switch: "Service charge 10%" or "GST 9%". */
function ChargeSwitch({ label, hint, charge, onChange }: { label: string; hint: string; charge: Charge; onChange: (on: boolean) => void }) {
  return (
    <label className="qs-setting">
      <span className="grow">
        <span className="t">
          {label} {percent(charge.bps)}
        </span>
        <span className="s"> {hint}</span>
      </span>
      <input type="checkbox" role="switch" className="qs-switch" checked={charge.on} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

/** Who paid: you, unless you change it to someone in the split. */
function PaidBy({ draft, setDraft }: { draft: QuickDraft; setDraft: SetDraft }) {
  const [changing, setChanging] = useState(false)
  const payer = draft.people.find((p) => p.key === draft.payerKey)!
  const nameOf = (i: number, name: string) => (i === 0 ? 'You' : name)
  return (
    <section className="card" aria-label="Paid by">
      <div className="qs-payer">
        <span className="lbl">Paid by</span>
        <Avatar avatar={payer.avatar} size="sm" mood="happy" />
        <span className="grow">{nameOf(draft.people.indexOf(payer), payer.name)}</span>
        <button type="button" className="btn small ghost" aria-expanded={changing} onClick={() => setChanging((c) => !c)}>
          Change
        </button>
      </div>
      {changing &&
        (draft.people.length > 1 ? (
          <div className="qs-who qs-below" role="group" aria-label="Who paid?">
            {draft.people.map((p, i) => (
              <button
                type="button"
                key={p.key}
                className="qs-tap"
                aria-pressed={p.key === draft.payerKey}
                onClick={() => {
                  setDraft((d) => ({ ...d, payerKey: p.key }))
                  setChanging(false)
                }}
              >
                <Avatar avatar={p.avatar} size="sm" />
                {nameOf(i, p.name)}
              </button>
            ))}
          </div>
        ) : (
          <p className="s qs-below">
            Add who's splitting on the next step, then come back here to pick someone else.
          </p>
        ))}
    </section>
  )
}

/** Step 1: what it was for, the dishes (scanned, from a photo, or typed), the charges and who paid. */
export function BillStep({ draft, setDraft }: { draft: QuickDraft; setDraft: SetDraft }) {
  const bill = billSoFar(draft)
  const check = totalCheck(draft)
  const updateDish = (key: string, patch: Partial<DraftDish>) =>
    setDraft((d) => ({ ...d, dishes: d.dishes.map((it) => (it.key === key ? { ...it, ...patch } : it)) }))
  return (
    <>
      <section className="card">
        <label className="f qs-first" htmlFor="qs-title">
          What's it for?
        </label>
        <input id="qs-title" type="text" maxLength={50} placeholder="Team lunch" value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
        <div className="qs-two">
          <div>
            <label className="f" htmlFor="qs-place">
              Where? (optional)
            </label>
            <input id="qs-place" type="text" maxLength={60} placeholder="Tanjong Pagar" value={draft.place} onChange={(e) => setDraft((d) => ({ ...d, place: e.target.value }))} />
          </div>
          <div>
            <label className="f" htmlFor="qs-date">
              Date
            </label>
            <input id="qs-date" type="date" value={draft.spentOn} onChange={(e) => setDraft((d) => ({ ...d, spentOn: e.target.value }))} />
          </div>
        </div>
        <ScanReceiptCard groupId={null} currency="SGD" hasEnteredAmounts={hasTypedDishes(draft)} onScan={(scan) => setDraft((d) => applyScan(d, scan))} />
        <div className="qs-dishes">
          {draft.dishes.map((it, i) => (
            <div className="qs-dish-row" role="group" aria-label={`Dish ${i + 1}`} key={it.key}>
              <input type="text" maxLength={60} placeholder="Laksa" aria-label="Dish name" value={it.name} onChange={(e) => updateDish(it.key, { name: e.target.value })} />
              <input type="text" inputMode="decimal" placeholder="0.00" aria-label="Price" value={it.price} onChange={(e) => updateDish(it.key, { price: e.target.value })} />
              {draft.dishes.length > 1 ? (
                <button type="button" className="x" aria-label={`Remove dish ${i + 1}`} onClick={() => setDraft((d) => ({ ...d, dishes: d.dishes.filter((x) => x.key !== it.key) }))}>
                  ×
                </button>
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          className="btn small"
          onClick={() => setDraft((d) => ({ ...d, dishes: [...d.dishes, emptyDish()] }))}
          disabled={draft.dishes.length >= QUICK_SPLIT_MAX_ITEMS}
        >
          <UiIcon name="plus" />
          Add a dish
        </button>
      </section>

      <section className="card" aria-label="Charges">
        <ChargeSwitch label="Service charge" hint="added to the dishes" charge={draft.service} onChange={(on) => setDraft((d) => ({ ...d, service: { ...d.service, on } }))} />
        <ChargeSwitch
          label="GST"
          hint={draft.service.on ? 'added after the service charge' : 'added to the dishes'}
          charge={draft.gst}
          onChange={(on) => setDraft((d) => ({ ...d, gst: { ...d.gst, on } }))}
        />
        <div className="sumrows" role="region" aria-label="The bill">
          <div>
            <span>Dishes</span>
            <b>{money(bill?.subtotalCents ?? 0)}</b>
          </div>
          {draft.service.on && (
            <div>
              <span>Service charge {percent(draft.service.bps)}</span>
              <b>{money(bill?.serviceChargeCents ?? 0)}</b>
            </div>
          )}
          {draft.gst.on && (
            <div>
              <span>GST {percent(draft.gst.bps)}</span>
              <b>{money(bill?.gstCents ?? 0)}</b>
            </div>
          )}
          <div className="tot">
            <span>Total</span>
            <b>{money(bill?.totalCents ?? 0)}</b>
          </div>
        </div>
        {/* After a scan: the receipt's own total, to check the dishes against. */}
        {draft.receiptTotal !== null && (
          <div className="qs-receipt-total">
            <label className="f" htmlFor="qs-receipt-total">
              Receipt total
            </label>
            <input
              id="qs-receipt-total"
              type="text"
              inputMode="decimal"
              className="amount"
              placeholder={bill ? centsToInput(bill.totalCents) : '0.00'}
              value={draft.receiptTotal}
              onChange={(e) => setDraft((d) => ({ ...d, receiptTotal: e.target.value }))}
            />
            <span className="field-hint">From your receipt. Clear it to go by the dishes.</span>
          </div>
        )}
        {check && <TotalFixup check={check} money={money} onAdd={() => setDraft(addOtherDish)} />}
      </section>

      <PaidBy draft={draft} setDraft={setDraft} />
    </>
  )
}
