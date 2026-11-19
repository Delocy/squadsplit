import { formatMoney, type ExpenseDTO, type FeedItem } from '@squadsplit/shared'
import { useState, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Avatar } from '../design/Avatar'
import { CATEGORY_ART, CategoryIcon, categoryLabel, UiIcon } from '../design/icons'
import type { People } from '../groupData'

type Tab = 'all' | 'expenses' | 'paybacks'
const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'paybacks', label: 'Paybacks' },
]

const inTab = (tab: Tab, item: FeedItem) =>
  tab === 'all' || (tab === 'expenses' ? item.type === 'expense' : item.type === 'settlement')

const itemKey = (i: FeedItem) =>
  i.type === 'expense' ? `e:${i.expense.id}` : i.type === 'settlement' ? `s:${i.settlement.id}` : i.type === 'spin' ? `w:${i.spin.id}` : `j:${i.userId}`

/** The group's activity, newest first (the API's order), filtered by tab. */
export function Feed({
  groupId,
  items,
  me,
  ownerId,
  people,
  currency,
}: {
  groupId: string
  items: FeedItem[] | undefined
  me: string
  ownerId: string
  people: People
  currency: string
}) {
  const [tab, setTab] = useState<Tab>('all')
  const money = (cents: number) => formatMoney(cents, currency)
  const av = (userId: string, mood?: 'happy' | 'calm' | 'nervous') => (
    <Avatar userId={userId} size="sm" mood={mood} faded={people.isFormer(userId)} />
  )

  function expenseRow(e: ExpenseDTO): ReactNode {
    const share = e.shares.find((s) => s.userId === me)?.amountCents ?? 0
    // Mirrors the API rule: the creator or the owner may change it, and only while it is unlocked.
    const canEdit = !e.locked && (e.createdBy === me || ownerId === me)
    const ways = e.shares.length === 1 ? 'for one person' : `split ${e.shares.length} ways`
    return (
      <>
        <div className="tile" style={{ '--tb': CATEGORY_ART[e.category]?.tint ?? '#fff' } as CSSProperties}>
          <CategoryIcon category={e.category} />
        </div>
        <div className="grow">
          <div className="t">
            {e.description}
            {e.locked && (
              <span className="lock">
                <UiIcon name="lock" />
                locked
              </span>
            )}
          </div>
          <div className="s">
            {people.you(e.paidBy)} paid · {categoryLabel(e.category)} · {ways}
          </div>
        </div>
        <div className="amt-r">
          {money(e.amountCents)}
          <span className="sub">{share ? `your share ${money(share)}` : 'not involved'}</span>
        </div>
        {canEdit && (
          <Link to={`/groups/${groupId}/expenses/${e.id}`} className="btn small ghost" aria-label={`Edit ${e.description}`}>
            Edit
          </Link>
        )}
      </>
    )
  }

  function row(item: FeedItem): ReactNode {
    switch (item.type) {
      case 'expense':
        return expenseRow(item.expense)
      case 'settlement': {
        const s = item.settlement
        return (
          <>
            {av(s.fromUserId)}
            <span className="arrow">
              <UiIcon name="arrow" />
            </span>
            {av(s.toUserId)}
            <div className="grow">
              <div className="t">
                {people.you(s.fromUserId)} paid {people.you(s.toUserId, true)}
              </div>
              <div className="s">Payback</div>
            </div>
            <div className="amt-r">{money(s.amountCents)}</div>
            <span className="status">{s.status}</span>
          </>
        )
      }
      case 'spin': {
        const { winnerId, spunBy } = item.spin
        return (
          <>
            {av(winnerId, 'nervous')}
            <div className="grow">
              <div className="t">{winnerId === me ? 'You were' : `${people.name(winnerId)} was`} picked to pay next</div>
              <div className="s">Wheel spin by {people.you(spunBy, true)}</div>
            </div>
          </>
        )
      }
      case 'join':
        return (
          <>
            {av(item.userId, 'happy')}
            <div className="grow">
              <div className="t">{people.you(item.userId)} joined the group</div>
              <div className="s">New member</div>
            </div>
          </>
        )
    }
  }

  const shown = (items ?? []).filter((i) => inTab(tab, i))
  return (
    <section className="card" aria-labelledby="activity-h">
      <h3 id="activity-h">
        <UiIcon name="receipt" />
        Activity
        <span className="right tabs">
          {TABS.map((t) => (
            <button key={t.key} className={t.key === tab ? 'on' : undefined} aria-pressed={t.key === tab} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </span>
      </h3>
      <ul className="list">
        {items === undefined ? (
          <li className="empty">Loading…</li>
        ) : shown.length ? (
          shown.map((i) => (
            <li className="row" key={itemKey(i)}>
              {row(i)}
            </li>
          ))
        ) : (
          <li className="empty">Nothing here yet.</li>
        )}
      </ul>
    </section>
  )
}
