import type { GroupSummaryDTO } from '@squadsplit/shared'
import { useQuery } from '@tanstack/react-query'
import type { CSSProperties } from 'react'
import { Link } from 'react-router'
import { useApi } from '../api'
import { ErrorNote } from '../components/ErrorNote'
import { Money } from '../components/Money'
import { avatarFor } from '../design/Avatar'
import { Mascot, UiIcon, type Mood } from '../design/icons'
import { queryKeys } from '../queryKeys'

function balanceText(cents: number): { label: string; mood: Mood } {
  if (cents > 0) return { label: "You're owed", mood: 'happy' }
  if (cents < 0) return { label: 'You owe', mood: 'nervous' }
  return { label: 'All square', mood: 'calm' }
}

function GroupCard({ group }: { group: GroupSummaryDTO }) {
  const look = avatarFor(group.id)
  const { label, mood } = balanceText(group.myBalanceCents)
  return (
    <li>
      <Link to={`/groups/${group.id}`} className="card group-card">
        <span className={mood === 'nervous' ? 'tile shiver' : 'tile'} style={{ '--tb': look.bg } as CSSProperties}>
          <Mascot kind={look.kind} face={look.face} mood={mood} />
        </span>
        <span className="grow">
          <span className="name">{group.name}</span>
          <span className="status">{group.role === 'owner' ? 'Owner' : 'Member'}</span>
        </span>
        <span className="amt-r">
          <span className="sub">{label}</span>
          {group.myBalanceCents !== 0 && (
            <span className={group.myBalanceCents > 0 ? 'pos' : 'neg'}>
              <Money cents={group.myBalanceCents} currency={group.currency} />
            </span>
          )}
        </span>
      </Link>
    </li>
  )
}

function NewGroupButton() {
  return (
    <Link to="/groups/new" className="btn primary">
      <UiIcon name="plus" />
      New group
    </Link>
  )
}

export function Groups() {
  const api = useApi()
  const groups = useQuery({ queryKey: queryKeys.groups, queryFn: () => api.get<GroupSummaryDTO[]>('/groups') })

  return (
    <main className="narrow page">
      <div className="page-h">
        <h2>Your groups</h2>
        {groups.data?.length !== 0 && <NewGroupButton />}
      </div>
      {groups.isPending && <p className="empty">Loading your groups…</p>}
      {groups.isError && <ErrorNote error={groups.error} />}
      {groups.data?.length === 0 && (
        <section className="card empty-state">
          <div className="hero-mark bob">
            <Mascot kind="panda" face="#ffffff" mood="calm" />
          </div>
          <h3>No groups yet</h3>
          <p className="empty">Start one for your next trip or dinner, or open an invite link from a friend.</p>
          <NewGroupButton />
        </section>
      )}
      {!!groups.data?.length && (
        <ul className="groups">
          {groups.data.map((g) => (
            <GroupCard key={g.id} group={g} />
          ))}
        </ul>
      )}
    </main>
  )
}
