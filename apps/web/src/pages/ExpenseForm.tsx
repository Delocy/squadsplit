import {
  CATEGORIES,
  formatMoney,
  type CreateExpenseInput,
  type ExpenseDTO,
  type GroupDTO,
  type MemberDTO,
} from '@squadsplit/shared'
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type MutableRefObject, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useApi } from '../api'
import { ConfirmBar, useConfirmStep } from '../components/ConfirmBar'
import { ErrorNote } from '../components/ErrorNote'
import { ScanReceiptCard } from '../components/ScanReceiptCard'
import { TotalFixup } from '../components/TotalFixup'
import { Sheet, useSheetClose } from '../components/Sheet'
import { ExpenseFormSkeleton } from '../components/Skeletons'
import { Avatar } from '../design/Avatar'
import { BusyLabel } from '../design/Busy'
import { confetti } from '../design/confetti'
import { CATEGORY_ART, CategoryIcon, UiIcon } from '../design/icons'
import {
  addOtherItem,
  applyScan,
  centsToInput,
  draftFromExpense,
  emptyItem,
  hasEnteredAmounts,
  newDraft,
  summarize,
  type ExpenseDraft,
  type ItemDraft,
  type SplitMode,
} from '../expenseDraft'
import { formerMemberIn, peopleOf, useExpenses, useGroup, useGroupMutation } from '../groupData'
import { useMyId } from '../guest/GroupAccess'

const MODES: { key: SplitMode; label: string }[] = [
  { key: 'equal', label: 'Equally' },
  { key: 'exact', label: 'Exact amounts' },
  { key: 'itemized', label: 'By item' },
]

/**
 * May the sheet close now? It asks first when there are unsaved changes (and answers false). Set by the form inside
 * the sheet; with nothing in it, the sheet just closes.
 */
type CloseGuard = MutableRefObject<(() => boolean) | null>

/**
 * `/groups/:id/expenses/new` and `/groups/:id/expenses/:expenseId`: the add/edit sheet over the group home (a bottom
 * sheet on a phone, a centred dialog on wider screens). Escape, the ×, a swipe down and Cancel all ask before
 * dropping unsaved changes.
 */
export function ExpenseForm() {
  const { id: groupId = '', expenseId } = useParams()
  const me = useMyId()
  const navigate = useNavigate()
  const group = useGroup(groupId)
  const expenses = useExpenses(groupId)
  // Back to the group, staying where it was scrolled to. The sheet slides out first (not under reduced motion).
  const sheet = useSheetClose(() => navigate(`/groups/${groupId}`, { preventScrollReset: true }))
  const guard: CloseGuard = useRef(null)
  const requestClose = () => {
    if (guard.current && !guard.current()) return
    sheet.close()
  }

  const expense = expenseId ? expenses.data?.find((e) => e.id === expenseId) : undefined
  const people = group.data ? peopleOf(group.data, me) : null
  const leftMember = expense && people ? formerMemberIn(expense, people) : null
  let body: ReactNode
  if (!group.data || (expenseId && expenses.isPending)) body = <ExpenseFormSkeleton />
  else if (expenseId && !expense) body = <Notice onClose={sheet.close}>We can't find this expense. It may have been deleted.</Notice>
  else if (expense?.locked) {
    body = (
      <Notice onClose={sheet.close}>
        This expense is locked: a payment has been confirmed since it was logged, so it can't be changed.
      </Notice>
    )
  } else if (leftMember && people) {
    body = <Notice onClose={sheet.close}>{people.name(leftMember)} has left the group, so this expense can't be changed.</Notice>
  } else if (expense && expense.createdBy !== me && group.data.ownerId !== me) {
    body = <Notice onClose={sheet.close}>Only the person who logged this expense or the group owner can change it.</Notice>
  } else {
    body = (
      <ExpenseFields
        key={expenseId ?? 'new'}
        group={group.data}
        me={me}
        expense={expense}
        guard={guard}
        onCancel={requestClose}
        onDone={sheet.close}
      />
    )
  }

  return (
    <Sheet title={expenseId ? 'Edit expense' : 'New expense'} leaving={sheet.leaving} onClose={requestClose} className="expense-sheet">
      {body}
    </Sheet>
  )
}

function Notice({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <>
      <p className="notice">
        <UiIcon name="lock" />
        <span>{children}</span>
      </p>
      <div className="dlg-f sheet-foot">
        <button type="button" className="btn" onClick={onClose}>
          Back to the group
        </button>
      </div>
    </>
  )
}

/** Toggle chips, one per current member, after an optional one-tap "Everyone had this". */
function MemberChips({
  label,
  members,
  isOn,
  onToggle,
  onEveryone,
}: {
  label: string
  members: MemberDTO[]
  isOn: (userId: string) => boolean
  onToggle: (userId: string) => void
  /** Puts everyone on it, or takes everyone off once they all are. */
  onEveryone?: (all: boolean) => void
}) {
  const allOn = members.every((m) => isOn(m.userId))
  return (
    <div className="chips" role="group" aria-label={label}>
      {onEveryone && (
        <button type="button" className={allOn ? 'chip everyone on' : 'chip everyone'} aria-pressed={allOn} onClick={() => onEveryone(!allOn)}>
          Everyone had this
        </button>
      )}
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
  guard,
  onCancel,
  onDone,
}: {
  group: GroupDTO
  me: string
  expense: ExpenseDTO | undefined
  /** Set here: asks before the sheet closes over unsaved changes. */
  guard: CloseGuard
  /** Cancel: closes, asking first if anything changed. */
  onCancel: () => void
  /** Closes at once (saved, deleted, or discarded). */
  onDone: () => void
}) {
  const api = useApi()
  const active = group.members.filter((m) => m.active)
  const activeIds = active.map((m) => m.userId)
  const currency = group.currency
  const money = (cents: number) => formatMoney(cents, currency)

  const [start] = useState<ExpenseDraft>(() => (expense ? draftFromExpense(expense, activeIds) : newDraft(me, activeIds, today())))
  const [draft, setDraft] = useState<ExpenseDraft>(start)
  const [problem, setProblem] = useState<string | null>(null)
  const confirmDelete = useConfirmStep()
  const confirmDiscard = useConfirmStep()
  const submitRef = useRef<HTMLButtonElement>(null)
  const descriptionRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const description = descriptionRef.current
    // On a touch screen, focusing a field pops up the keyboard, which would cover the receipt card at the top. Focus
    // the dialog instead, so screen readers still land in it.
    if (window.matchMedia?.('(pointer: coarse)').matches) description?.closest('dialog')?.focus()
    else description?.focus()
  }, [])

  const save = useGroupMutation(group.id, (input: CreateExpenseInput) =>
    expense ? api.patch<ExpenseDTO>(`/expenses/${expense.id}`, input) : api.post<ExpenseDTO>(`/groups/${group.id}/expenses`, input),
  )
  const remove = useGroupMutation(group.id, (id: string) => api.del(`/expenses/${id}`))
  const dirty = draft !== start && JSON.stringify(draft) !== JSON.stringify(start)
  guard.current = () => {
    if (!dirty || save.isPending || remove.isPending) return true
    confirmDiscard.open()
    return false
  }
  // Gone (saved, or the sheet shows something else): nothing left to ask about.
  useEffect(() => () => void (guard.current = null), [guard])

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
      {/* New expenses only: one obvious place to start from a receipt, whatever the split. */}
      {!expense && (
        <ScanReceiptCard
          groupId={group.id}
          currency={currency}
          hasEnteredAmounts={hasEnteredAmounts(draft)}
          onScan={(scan) => {
            setProblem(null)
            setDraft((d) => applyScan(d, scan))
          }}
        />
      )}
      <div className="two">
        <div>
          <label className="f" htmlFor="exp-desc">
            Description
          </label>
          <input
            ref={descriptionRef}
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
            <label className="f" htmlFor="exp-total">
              Total ({currency})
            </label>
            <input
              id="exp-total"
              className="amount"
              type="text"
              inputMode="decimal"
              data-testid="bill-total"
              placeholder={summary.bill ? centsToInput(summary.bill.total) : '0.00'}
              value={draft.amount}
              onChange={(e) => update({ amount: e.target.value })}
            />
            <span className="field-hint">Leave blank to use the items' total.</span>
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
      {/* At the total: one line on how far off the items are, and the fix. */}
      {draft.mode === 'itemized' && summary.check && (
        <TotalFixup check={summary.check} money={money} onAdd={() => update(addOtherItem(draft, activeIds))} />
      )}

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
          <div className="charges">
            <label className="chip toggle">
              <input type="checkbox" checked={draft.serviceOn} onChange={(e) => update({ serviceOn: e.target.checked })} />
              <span>Service charge {draft.charges.serviceChargeBps / 100}%</span>
            </label>
            <label className="chip toggle">
              <input type="checkbox" checked={draft.gstOn} onChange={(e) => update({ gstOn: e.target.checked })} />
              <span>GST {draft.charges.gstBps / 100}%</span>
            </label>
          </div>
          {draft.items.length > 1 && draft.items.some((it) => it.userIds.length === 0) && (
            <button
              type="button"
              className="btn small assign-all"
              onClick={() => update({ items: draft.items.map((it) => (it.userIds.length ? it : { ...it, userIds: activeIds })) })}
            >
              Assign all to everyone
            </button>
          )}
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
                  onEveryone={(all) => updateItem(it.key, { userIds: all ? activeIds : [] })}
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
          {summary.bill && (draft.serviceOn || draft.gstOn) && (
            <p className="preview">
              Subtotal <b>{money(summary.bill.subtotal)}</b>
              {draft.serviceOn && (
                <>
                  {' · '}Service charge {draft.charges.serviceChargeBps / 100}% <b>{money(summary.bill.serviceCharge)}</b>
                </>
              )}
              {draft.gstOn && (
                <>
                  {' · '}GST {draft.charges.gstBps / 100}% <b>{money(summary.bill.gst)}</b>
                </>
              )}
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

      {expense &&
        (confirmDelete.showBar ? (
          <ConfirmBar
            question={`Delete ${expense.description}? It can't be undone.`}
            yes="Delete"
            busyLabel="Deleting…"
            busy={remove.isPending}
            leaving={confirmDelete.leaving}
            onYes={() => remove.mutate(expense.id, { onSuccess: onDone })}
            onCancel={confirmDelete.close}
          />
        ) : (
          <button
            ref={confirmDelete.triggerRef}
            type="button"
            className="btn ghost danger delete-expense"
            onClick={confirmDelete.open}
            disabled={save.isPending}
          >
            Delete this expense
          </button>
        ))}

      {/* Cancel and Save stay at the bottom of the sheet, above the keyboard. */}
      <div className="dlg-f sheet-foot">
        {confirmDiscard.showBar ? (
          <ConfirmBar
            question={expense ? 'Discard your changes?' : 'Discard this expense?'}
            yes="Discard"
            no="Keep editing"
            busyLabel="Discarding…"
            busy={false}
            leaving={confirmDiscard.leaving}
            onYes={onDone}
            onCancel={confirmDiscard.close}
          />
        ) : (
          <>
            <button type="button" className="btn ghost" onClick={onCancel}>
              Cancel
            </button>
            <button
              ref={submitRef}
              type="submit"
              className="btn primary"
              disabled={save.isPending || remove.isPending || (draft.mode === 'exact' && summary.leftToAssign !== 0) || summary.check !== null}
            >
              <BusyLabel busy={save.isPending} label={expense ? 'Saving…' : 'Adding…'}>
                {expense ? 'Save changes' : 'Add expense'}
              </BusyLabel>
            </button>
          </>
        )}
      </div>
    </form>
  )
}
