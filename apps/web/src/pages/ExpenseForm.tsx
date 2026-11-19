import { useAuth } from '@clerk/react'
import {
  CATEGORIES,
  formatMoney,
  type CreateExpenseInput,
  type ExpenseDTO,
  type GroupDTO,
  type MemberDTO,
} from '@squadsplit/shared'
import { useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useApi } from '../api'
import { ErrorNote } from '../components/ErrorNote'
import { ScanReceiptButton } from '../components/ScanReceiptButton'
import { Avatar } from '../design/Avatar'
import { confetti } from '../design/confetti'
import { CATEGORY_ART, CategoryIcon, UiIcon } from '../design/icons'
import {
  applyScan,
  draftFromExpense,
  emptyItem,
  hasTypedItems,
  newDraft,
  summarize,
  type ExpenseDraft,
  type ItemDraft,
  type SplitMode,
} from '../expenseDraft'
import { formerMemberIn, peopleOf, useExpenses, useGroup, useGroupMutation } from '../groupData'

const MODES: { key: SplitMode; label: string }[] = [
  { key: 'equal', label: 'Equally' },
  { key: 'exact', label: 'Exact amounts' },
  { key: 'itemized', label: 'By item' },
]

/** `/groups/:id/expenses/new` and `/groups/:id/expenses/:expenseId`: the add/edit dialog over the group home. */
export function ExpenseForm() {
  const { id: groupId = '', expenseId } = useParams()
  const me = useAuth().userId ?? ''
  const navigate = useNavigate()
  const group = useGroup(groupId)
  const expenses = useExpenses(groupId)
  const close = () => navigate(`/groups/${groupId}`)

  const expense = expenseId ? expenses.data?.find((e) => e.id === expenseId) : undefined
  const people = group.data ? peopleOf(group.data, me) : null
  const leftMember = expense && people ? formerMemberIn(expense, people) : null
  let body: ReactNode
  if (!group.data || (expenseId && expenses.isPending)) body = <p className="empty">Loading…</p>
  else if (expenseId && !expense) body = <Notice onClose={close}>We can't find this expense. It may have been deleted.</Notice>
  else if (expense?.locked) {
    body = (
      <Notice onClose={close}>
        This expense is locked: a payment has been confirmed since it was logged, so it can't be changed.
      </Notice>
    )
  } else if (leftMember && people) {
    body = <Notice onClose={close}>{people.name(leftMember)} has left the group, so this expense can't be changed.</Notice>
  } else if (expense && expense.createdBy !== me && group.data.ownerId !== me) {
    body = <Notice onClose={close}>Only the person who logged this expense or the group owner can change it.</Notice>
  } else {
    body = <ExpenseFields key={expenseId ?? 'new'} group={group.data} me={me} expense={expense} onDone={close} />
  }

  return (
    <Dialog title={expenseId ? 'Edit expense' : 'New expense'} onClose={close}>
      {body}
    </Dialog>
  )
}

/** A native modal <dialog> (Escape closes it), opened as it mounts. */
function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => {
    const d = ref.current
    if (!d || d.open) return
    // jsdom has no showModal; the open attribute is the same dialog, just not modal.
    if (typeof d.showModal === 'function') d.showModal()
    else d.setAttribute('open', '')
  }, [])
  return (
    <dialog
      ref={ref}
      aria-labelledby="dlg-title"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <div className="dlg-h">
        <UiIcon name="plus" />
        <h3 id="dlg-title">{title}</h3>
        <button type="button" className="x" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="dlg-b">{children}</div>
    </dialog>
  )
}

function Notice({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <>
      <p className="notice">
        <UiIcon name="lock" />
        <span>{children}</span>
      </p>
      <div className="dlg-f">
        <button type="button" className="btn" onClick={onClose}>
          Back to the group
        </button>
      </div>
    </>
  )
}

/** Toggle chips, one per current member. */
function MemberChips({
  label,
  members,
  isOn,
  onToggle,
}: {
  label: string
  members: MemberDTO[]
  isOn: (userId: string) => boolean
  onToggle: (userId: string) => void
}) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {members.map((m) => (
        <button
          type="button"
          key={m.userId}
          className={isOn(m.userId) ? 'chip on' : 'chip'}
          aria-pressed={isOn(m.userId)}
          onClick={() => onToggle(m.userId)}
        >
          <Avatar avatar={m.avatar} size="sm" />
          {m.displayName}
        </button>
      ))}
    </div>
  )
}

const today = () => new Date().toLocaleDateString('en-CA') // YYYY-MM-DD in the local time zone

function ExpenseFields({
  group,
  me,
  expense,
  onDone,
}: {
  group: GroupDTO
  me: string
  expense: ExpenseDTO | undefined
  onDone: () => void
}) {
  const api = useApi()
  const active = group.members.filter((m) => m.active)
  const activeIds = active.map((m) => m.userId)
  const currency = group.currency
  const money = (cents: number) => formatMoney(cents, currency)

  const [draft, setDraft] = useState<ExpenseDraft>(() =>
    expense ? draftFromExpense(expense, activeIds) : newDraft(me, activeIds, today()),
  )
  const [problem, setProblem] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const submitRef = useRef<HTMLButtonElement>(null)

  const save = useGroupMutation(group.id, (input: CreateExpenseInput) =>
    expense ? api.patch<ExpenseDTO>(`/expenses/${expense.id}`, input) : api.post<ExpenseDTO>(`/groups/${group.id}/expenses`, input),
  )
  const remove = useGroupMutation(group.id, (id: string) => api.del(`/expenses/${id}`))

  const update = (patch: Partial<ExpenseDraft>) => {
    setProblem(null)
    setDraft((d) => ({ ...d, ...patch }))
  }
  const updateItem = (key: number, patch: Partial<ItemDraft>) =>
    update({ items: draft.items.map((it) => (it.key === key ? { ...it, ...patch } : it)) })
  const toggle = (ids: string[], id: string) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])

  const summary = summarize(draft, activeIds, currency)
  const name = (userId: string) => active.find((m) => m.userId === userId)?.displayName ?? 'Someone'

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!summary.input) return setProblem(summary.problem)
    const button = submitRef.current
    save.mutate(summary.input, {
      onSuccess: () => {
        if (!expense) confetti(button)
        onDone()
      },
    })
  }

  const preview =
    summary.shares &&
    Object.entries(summary.shares)
      .sort(([a], [b]) => activeIds.indexOf(a) - activeIds.indexOf(b))
      .map(([userId, cents], i) => (
        <span key={userId}>
          {i > 0 && ' · '}
          {name(userId)} <b>{money(cents)}</b>
        </span>
      ))

  return (
    <form onSubmit={submit} noValidate>
      <div className="two">
        <div>
          <label className="f" htmlFor="exp-desc">
            Description
          </label>
          <input
            id="exp-desc"
            type="text"
            maxLength={100}
            placeholder="Dinner at Lau Pa Sat"
            value={draft.description}
            onChange={(e) => update({ description: e.target.value })}
          />
        </div>
        {draft.mode === 'itemized' ? (
          <div>
            <span className="f">Total ({currency})</span>
            <output className="amount total-out" data-testid="bill-total">
              {money(summary.bill?.total ?? 0)}
            </output>
          </div>
        ) : (
          <div>
            <label className="f" htmlFor="exp-amount">
              Amount ({currency})
            </label>
            <input
              id="exp-amount"
              className="amount"
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={draft.amount}
              onChange={(e) => update({ amount: e.target.value })}
            />
          </div>
        )}
      </div>

      <label className="f" htmlFor="exp-date">
        Date
      </label>
      <input id="exp-date" type="date" value={draft.spentOn} onChange={(e) => update({ spentOn: e.target.value })} />

      <span className="f">Category</span>
      <div className="chips" role="group" aria-label="Category">
        {CATEGORIES.map((c) => (
          <button
            type="button"
            key={c}
            className={c === draft.category ? 'chip on' : 'chip'}
            aria-pressed={c === draft.category}
            onClick={() => update({ category: c })}
          >
            <span className="ci" style={{ '--tint': CATEGORY_ART[c]?.tint } as CSSProperties}>
              <CategoryIcon category={c} />
            </span>
            {CATEGORY_ART[c]?.label}
          </button>
        ))}
      </div>

      <span className="f">Paid by</span>
      <MemberChips label="Paid by" members={active} isOn={(id) => id === draft.paidBy} onToggle={(id) => update({ paidBy: id })} />

      <div className="split-h">
        <span className="f">Split</span>
        <span className="tabs">
          {MODES.map((m) => (
            <button
              type="button"
              key={m.key}
              className={m.key === draft.mode ? 'on' : undefined}
              aria-pressed={m.key === draft.mode}
              onClick={() => update({ mode: m.key })}
            >
              {m.label}
            </button>
          ))}
        </span>
      </div>

      {draft.mode === 'equal' && (
        <>
          <span className="f">Split equally between</span>
          <MemberChips
            label="Split equally between"
            members={active}
            isOn={(id) => draft.participantIds.includes(id)}
            onToggle={(id) => update({ participantIds: toggle(draft.participantIds, id) })}
          />
        </>
      )}

      {draft.mode === 'exact' && (
        <>
          <div className="exact">
            {active.map((m) => (
              <div className="exact-row" key={m.userId}>
                <Avatar avatar={m.avatar} size="sm" />
                <span className="who">{m.displayName}</span>
                <input
                  id={`exact-${m.userId}`}
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  aria-label={`${m.displayName}'s share`}
                  value={draft.exact[m.userId] ?? ''}
                  onChange={(e) => update({ exact: { ...draft.exact, [m.userId]: e.target.value } })}
                />
              </div>
            ))}
          </div>
          <p className={summary.leftToAssign === 0 ? 'left done' : 'left'}>
            {summary.leftToAssign === null
              ? 'Enter the total first'
              : summary.leftToAssign === 0
                ? 'Everything is assigned.'
                : summary.leftToAssign > 0
                  ? `${money(summary.leftToAssign)} left to assign`
                  : `${money(-summary.leftToAssign)} too much assigned`}
          </p>
        </>
      )}

      {draft.mode === 'itemized' && (
        <>
          <ScanReceiptButton
            groupId={group.id}
            currency={currency}
            hasTypedItems={hasTypedItems(draft)}
            onScan={(scan) => {
              setProblem(null)
              setDraft((d) => applyScan(d, scan))
            }}
          />
          <label className="chip toggle">
            <input type="checkbox" checked={draft.restaurantBill} onChange={(e) => update({ restaurantBill: e.target.checked })} />
            <span>
              Restaurant bill (SG)
              <span className="hint">10% service charge, then 9% GST</span>
            </span>
          </label>
          <div className="items">
            {draft.items.map((it, i) => (
              <div className="item" role="group" aria-label={`Item ${i + 1}`} key={it.key}>
                <div className="item-h">
                  <input
                    type="text"
                    maxLength={60}
                    placeholder="Laksa"
                    aria-label="Item name"
                    value={it.name}
                    onChange={(e) => updateItem(it.key, { name: e.target.value })}
                  />
                  <input
                    type="text"
                    inputMode="decimal"
                    className="price"
                    placeholder="0.00"
                    aria-label="Price"
                    value={it.price}
                    onChange={(e) => updateItem(it.key, { price: e.target.value })}
                  />
                  {draft.items.length > 1 && (
                    <button
                      type="button"
                      className="x"
                      aria-label={`Remove item ${i + 1}`}
                      onClick={() => update({ items: draft.items.filter((x) => x.key !== it.key) })}
                    >
                      ×
                    </button>
                  )}
                </div>
                <MemberChips
                  label={`Who had item ${i + 1}`}
                  members={active}
                  isOn={(id) => it.userIds.includes(id)}
                  onToggle={(id) => updateItem(it.key, { userIds: toggle(it.userIds, id) })}
                />
              </div>
            ))}
          </div>
          <button
            type="button"
            className="btn small"
            onClick={() => update({ items: [...draft.items, emptyItem()] })}
            disabled={draft.items.length >= 50}
          >
            <UiIcon name="plus" />
            Add item
          </button>
          {summary.bill && draft.restaurantBill && (
            <p className="preview">
              Subtotal <b>{money(summary.bill.subtotal)}</b> · Service charge 10% <b>{money(summary.bill.serviceCharge)}</b> · GST
              9% <b>{money(summary.bill.gst)}</b>
            </p>
          )}
        </>
      )}

      {draft.mode !== 'exact' && (
        <p className="preview" data-testid="preview">
          {preview ? (
            <>
              Each share: {preview}
            </>
          ) : summary.tooSmall ? (
            'Too small to split that many ways.'
          ) : null}
        </p>
      )}

      {problem ? (
        <p className="err" role="alert">
          {problem}
        </p>
      ) : (
        <ErrorNote error={save.error ?? remove.error} />
      )}

      <div className="dlg-f">
        {expense &&
          (confirmDelete ? (
            <button type="button" className="btn ghost danger" onClick={() => remove.mutate(expense.id, { onSuccess: onDone })} disabled={remove.isPending}>
              Yes, delete it
            </button>
          ) : (
            <button type="button" className="btn ghost danger" onClick={() => setConfirmDelete(true)}>
              Delete
            </button>
          ))}
        <span className="spacer" />
        <button type="button" className="btn ghost" onClick={onDone}>
          Cancel
        </button>
        <button
          ref={submitRef}
          type="submit"
          className="btn primary"
          disabled={save.isPending || (draft.mode === 'exact' && summary.leftToAssign !== 0)}
        >
          {expense ? 'Save changes' : 'Add expense'}
        </button>
      </div>
    </form>
  )
}
