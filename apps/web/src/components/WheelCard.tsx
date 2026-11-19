import { spinWeightsFromBalances, type SpinDTO } from '@squadsplit/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useApi } from '../api'
import { Avatar } from '../design/Avatar'
import { confetti } from '../design/confetti'
import { UiIcon } from '../design/icons'
import { prefersReducedMotion } from '../design/motion'
import type { People } from '../groupData'
import { invalidateGroup } from '../queryKeys'
import { landingRotation, wheelSlices } from '../wheel'
import { ErrorNote } from './ErrorNote'
import { WheelDisc } from './WheelDisc'

/** How long the wheel turns (the .wheel transition in tokens.css), plus a beat before the winner shows. */
const SPIN_MS = 3050

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
  const spin = useMutation({
    mutationFn: () => api.post<SpinDTO>(`/groups/${groupId}/spins`),
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
    void invalidateGroup(queryClient, groupId)
  }, [revealed, queryClient, groupId])

  return { spin, result, rotation, winnerRef, spinning: spin.isPending || (result !== null && !revealed) }
}

/**
 * "Who pays next?": the wheel with everyone's animal on their slice, their odds, and a Spin button.
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
  const { spin, result, rotation, winnerRef, spinning } = useWheelSpin(groupId)
  const weights = result?.weights ?? spinWeightsFromBalances(balances ?? {}, people.active.map((m) => m.userId))
  const slices = wheelSlices(weights)

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
                <Avatar avatar={people.avatar(s.userId)} size="sm" />
                {people.name(s.userId)}
                <b>{s.percent}%</b>
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
                <Avatar avatar={people.avatar(result.winnerId)} mood="nervous" />
                <span>{result.winnerId === me ? 'You pay next' : `${people.name(result.winnerId)} pays next`}</span>
              </div>
            )}
          </div>
          {spin.isError && <ErrorNote error={spin.error} />}
        </div>
      </div>
      {children}
    </section>
  )
}
