import { PageLink } from '../components/PageLink'
import { CategoryIcon, UiIcon } from '../design/icons'
import { money } from './format'
import { progressLabel, whenLabel } from './QuickHistory'
import { useQuickSplits } from './quickData'
import './quick.css'

/** "Quick split", next to "New group". */
export function QuickSplitButton() {
  return (
    <PageLink to="/quick/new" className="btn">
      <UiIcon name="receipt" />
      Quick split
    </PageLink>
  )
}

/** Your quick splits on the groups page, newest first, each with how many have paid. Nothing until you have one. */
export function RecentQuickSplits() {
  const splits = useQuickSplits()
  if (!splits.data?.length) return null
  return (
    <section className="card qs-recent-card" aria-label="Recent quick splits">
      <h3>
        <UiIcon name="clock" />
        Recent quick splits
      </h3>
      <ul className="qs-recent">
        {splits.data.map((s) => (
          <li key={s.id}>
            <PageLink to={`/quick/${s.id}`} className="qs-recent-link">
              <span className="tile">
                <CategoryIcon category="🍕" />
              </span>
              <span className="grow">
                <span className="t">{s.place ? `${s.title}, ${s.place}` : s.title}</span>
                <span className="s">
                  {whenLabel(s.spentOn)} · {s.peopleCount} people{s.link === 'off' && ' · Link off'}
                </span>
              </span>
              <span className="amt-r">
                {money(s, s.totalCents)}
                <span className={s.paidCount === s.peopleCount ? 'qs-owed done' : 'qs-owed'}>{progressLabel(s.paidCount, s.peopleCount)}</span>
              </span>
            </PageLink>
          </li>
        ))}
      </ul>
    </section>
  )
}
