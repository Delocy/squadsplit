import { useAuth } from '@clerk/react'
import type { FeedItem, SpinDTO } from '@squadsplit/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useApi } from '../api'
import { ErrorNote } from '../components/ErrorNote'
import { GroupUnavailable } from '../components/GroupUnavailable'
import { WheelDisc } from '../components/WheelDisc'
import { Avatar } from '../design/Avatar'
import { confetti } from '../design/confetti'
import { UiIcon } from '../design/icons'
import { prefersReducedMotion } from '../design/motion'
import { peopleOf, useFeed, useGroup, type People } from '../groupData'
import { invalidateGroup } from '../queryKeys'
import { landingRotation, wheelSlices } from '../wheel'

/** How long the wheel turns (the .wheel transition in tokens.css), plus a beat before the winner shows. */
const SPIN_MS = 3050
const RECENT_SPINS = 5

/**
 * `/groups/:id/wheel`: "Who pays next?". The server picks the winner (weighted towards whoever owes most);
 * the wheel only animates to it, so there is no randomness here.
 */
export function Wheel() {
  const id = useParams().id ?? ''
  const me = useAuth().userId ?? ''
  const api = useApi()
  const queryClient = useQueryClient()
  const group = useGroup(id)
  const feed = useFeed(id)

  const [rotation, setRotation] = useState(0)
  const [result, setResult] = useState<SpinDTO | null>(null)
  const [revealed, setRevealed] = useState(false)
  const winnerRef = useRef<HTMLDivElement>(null)

  // Not useGroupMutation: refetching the feed straight away would list the winner before the wheel stops.
  const spin = useMutation({
    mutationFn: () => api.post<SpinDTO>(`/groups/${id}/spins`),
    onSuccess: (s) => {
      setRevealed(false)
      setResult(s)
      setRotation((r) => landingRotation(r, wheelSlices(s.weights), s.winnerId))
    },
  })

  useEffect(() => {
    if (!result || revealed) return
    const timer = setTimeout(() => setRevealed(true), prefersReducedMotion() ? 0 : SPIN_MS)
    return () => clearTimeout(timer)
  }, [result, revealed])

  useEffect(() => {
    if (!revealed) return
    confetti(winnerRef.current)
    void invalidateGroup(queryClient, id)
  }, [revealed, queryClient, id])

  if (group.isPending) {
    return (
      <main className="page">
        <p className="empty">Loading the group…</p>
      </main>
    )
  }
  if (group.isError) return <GroupUnavailable error={group.error} />

  const people = peopleOf(group.data, me)
  // Before the first spin we don't know the odds, so everyone gets an equal slice.
  const weights = result?.weights ?? Object.fromEntries(people.active.map((m) => [m.userId, 1]))
  const slices = wheelSlices(weights)
  const spinning = spin.isPending || (result !== null && !revealed)

  return (
    <main className="narrow page">
      <div className="page-h">
        <Link to={`/groups/${id}`} className="btn small ghost">
          Back to the group
        </Link>
      </div>

      <section className="card wheel-card" aria-labelledby="wheel-h">
        <h3 id="wheel-h">
          <UiIcon name="wheel" />
          Who pays next?
        </h3>
        <p className="s">Can't decide who gets the next round? Spin the wheel. People who owe more are more likely to be picked.</p>
        <div className="wheel-wrap">
          <WheelDisc slices={slices} rotation={rotation} />
          <div>
            <ul className="odds" aria-label="Odds">
              {slices.map((s) => (
                <li key={s.userId}>
                  <Avatar userId={s.userId} size="sm" />
                  {people.name(s.userId)}
                  {result && <b>{s.percent}%</b>}
                </li>
              ))}
            </ul>
            <div className="spin-row">
              <button className="btn primary" onClick={() => spin.mutate()} disabled={spinning}>
                <UiIcon name="star" />
                Spin
              </button>
            </div>
            <div className="winner" role="status">
              {spinning ? (
                <span className="s">Spinning…</span>
              ) : !result ? (
                <span className="s">Spin to find out</span>
              ) : (
                <div className="pop" key={result.id} ref={winnerRef}>
                  <Avatar userId={result.winnerId} mood="nervous" />
                  <span>{result.winnerId === me ? 'You pay next' : `${people.name(result.winnerId)} pays next`}</span>
                </div>
              )}
            </div>
            {spin.isError && <ErrorNote error={spin.error} />}
          </div>
        </div>
      </section>

      <RecentSpins items={feed.data} me={me} people={people} />
    </main>
  )
}

function RecentSpins({ items, me, people }: { items: FeedItem[] | undefined; me: string; people: People }) {
  const spins = (items ?? []).flatMap((i) => (i.type === 'spin' ? [i.spin] : [])).slice(0, RECENT_SPINS)
  return (
    <section className="card" aria-labelledby="recent-h">
      <h3 id="recent-h">
        <UiIcon name="clock" />
        Recent spins
      </h3>
      <ul className="list">
        {items === undefined ? (
          <li className="empty">Loading…</li>
        ) : spins.length ? (
          spins.map((s) => (
            <li className="row" key={s.id}>
              <Avatar userId={s.winnerId} size="sm" mood="nervous" faded={people.isFormer(s.winnerId)} />
              <div className="grow">
                <div className="t">{s.winnerId === me ? 'You were picked' : `${people.name(s.winnerId)} was picked`}</div>
                <div className="s">Spun by {people.you(s.spunBy, true)}</div>
              </div>
            </li>
          ))
        ) : (
          <li className="empty">No spins yet.</li>
        )}
      </ul>
    </section>
  )
}
