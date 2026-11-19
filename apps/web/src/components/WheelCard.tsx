import { spinWeightsFromBalances, type SpinDTO } from '@squadsplit/shared'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useApi } from '../api'
import { Avatar } from '../design/Avatar'
import { Spinner } from '../design/Busy'
import { confetti } from '../design/confetti'
import { UiIcon } from '../design/icons'
import { balanceMood, moodOf } from '../design/mood'
import { prefersReducedMotion } from '../design/motion'
import type { People } from '../groupData'
import { invalidateGroup } from '../queryKeys'
import { useSingleFlightMutation } from '../singleFlight'
import { landingRotation, SPIN_DURATION_MS, wheelSlices } from '../wheel'
import { ErrorNote } from './ErrorNote'
import { WheelDisc } from './WheelDisc'

/** How long the wheel spins (see WheelDisc), plus a beat before the ticket slides out. */
const REVEAL_MS = SPIN_DURATION_MS + 150
/** How many of the squad wait by the slot; more would wrap at 375px. */
const WAITING = 8

/**
 * A spin of the group's wheel. The server picks the winner (weighted towards whoever owes most); the wheel
 * only animates to it, so there is no randomness here. The winner is revealed once the wheel stops.
 */
function useWheelSpin(groupId: string) {
  const api = useApi()
  const queryClient = useQueryClient()
  const [rotation, setRotation] = useState(0)
  const [result, setResult] = useState<SpinDTO | null>(null)
  const [revealed, setRevealed] = useState(false)
  const winnerRef = useRef<HTMLDivElement>(null)

  // Not useGroupMutation: refetching the feed straight away would list the winner before the wheel stops.
  const spin = useSingleFlightMutation({
    mutationFn: () => api.post<SpinDTO>(`/groups/${groupId}/spins`),
    onSuccess: (s) => {
      setRevealed(false)
      setResult(s)
      setRotation((r) => landingRotation(r, wheelSlices(s.weights), s.winnerId))
    },
  })

  useEffect(() => {
    if (!result || revealed) return
    const timer = setTimeout(() => setRevealed(true), prefersReducedMotion() ? 0 : REVEAL_MS)
    return () => clearTimeout(timer)
  }, [result, revealed])

  useEffect(() => {
    if (!revealed) return
    confetti(winnerRef.current)
    void invalidateGroup(queryClient, groupId)
  }, [revealed, queryClient, groupId])

  return { spin, result, rotation, winnerRef, revealed, spinning: spin.isPending || (result !== null && !revealed) }
}

/**
 * "Who pays next?": the wheel with everyone's animal on their slice, their odds, and a Spin button. When it stops, a
 * ticket slides out of the slot with the winner on it, shivering, and then the rest of the squad sighs "phew".
 * Before a spin the odds come from the current balances; afterwards, from the weights the server used.
 * `children` goes at the bottom of the card (the group home links to the wheel page from there).
 */
export function WheelCard({
  groupId,
  me,
  people,
  balances,
  compact = false,
  children,
}: {
  groupId: string
  me: string
  people: People
  /** Net balances, for the odds before the first spin. Everyone gets an equal slice until they load. */
  balances: Record<string, number> | undefined
  /** The smaller wheel for the group home's side column. */
  compact?: boolean
  children?: ReactNode
}) {
  const { spin, result, rotation, winnerRef, revealed, spinning } = useWheelSpin(groupId)
  const weights = result?.weights ?? spinWeightsFromBalances(balances ?? {}, people.active.map((m) => m.userId))
  const slices = wheelSlices(weights)
  // The squad waits by the slot; once the ticket is out, everyone but the winner sighs "phew". The winner keeps their
  // place in the row (hidden), so nothing moves.
  const waiting = people.active.slice(0, WAITING)

  return (
    <section className={compact ? 'card wheel-card compact' : 'card wheel-card'} aria-labelledby="wheel-h">
      <h3 id="wheel-h">
        <UiIcon name="wheel" />
        Who pays next?
      </h3>
      <p className="s">Can't decide who gets the next round? Spin the wheel. People who owe more are more likely to be picked.</p>
      <div className="wheel-wrap">
        <WheelDisc slices={slices} rotation={rotation} avatarOf={people.avatar} />
        <div>
          <ul className="odds" aria-label="Odds">
            {slices.map((s) => (
              <li key={s.userId}>
                <Avatar avatar={people.avatar(s.userId)} size="sm" {...balanceMood(balances?.[s.userId] ?? 0)} />
                {people.name(s.userId)}
                <b>{s.percent}%</b>
              </li>
            ))}
          </ul>
          <div className="spin-row">
            <button className="btn primary" onClick={() => spin.mutate()} disabled={spinning}>
              {spin.isPending ? <Spinner /> : <UiIcon name="star" />}
              Spin
            </button>
          </div>
          {spin.isError && <ErrorNote error={spin.error} />}
        </div>
      </div>
      <div className="slot" role="status">
        {result && revealed ? (
          <div className="ticket" key={result.id} ref={winnerRef}>
            <div className="tk-l">
              <span className="shiver">
                <Avatar avatar={people.avatar(result.winnerId)} size="lg" mood="nervous" sweat={2} />
              </span>
            </div>
            <div className="tk-r">
              <span className="lbl">Next round</span>
              <b>{result.winnerId === me ? 'You pay next' : `${people.name(result.winnerId)} pays next`}</b>
              <span className="s">{slices.find((s) => s.userId === result.winnerId)?.percent ?? 0}% odds</span>
            </div>
          </div>
        ) : (
          <span className="s">{spinning ? 'Spinning…' : 'Spin to find out'}</span>
        )}
      </div>
      <div className={result && revealed ? 'relief on' : 'relief'} aria-hidden="true">
        {waiting.map((m, i) => {
          const picked = result !== null && revealed && m.userId === result.winnerId
          return (
            <span className={picked ? 'sigh picked' : 'sigh'} key={m.userId} style={{ '--i': i } as CSSProperties}>
              <Avatar avatar={m.avatar} size="sm" title={m.displayName} mood={result && revealed ? 'happy' : moodOf(balances?.[m.userId] ?? 0)} />
              <em>phew</em>
            </span>
          )
        })}
      </div>
      {children}
    </section>
  )
}
