import { formatMoney, type FeedItem, type FunDTO, type SettlementDTO } from '@squadsplit/shared'
import { useEffect, useRef, type MouseEvent } from 'react'
import { useApi } from '../api'
import { Avatar } from '../design/Avatar'
import { BusyLabel } from '../design/Busy'
import { confetti } from '../design/confetti'
import { useGroupMutation, type People } from '../groupData'
import { ErrorNote } from './ErrorNote'
import { goodEggOf, useSettleMoment } from './SettleMoment'

type Action = 'confirm' | 'reject' | 'cancel'

/**
 * Pending settlements that involve you: as the creditor you confirm or reject them,
 * as the debtor you can undo (cancel) them while they wait. Confirming one plays the settle-up moment, and so does
 * the creditor confirming one of yours while you have the page open.
 */
export function PendingActions({
  groupId,
  pending,
  me,
  people,
  currency,
  fun,
  feed,
}: {
  groupId: string
  pending: SettlementDTO[]
  me: string
  people: People
  currency: string
  /** The group's titles, to tell when a payback earns the payer the Good Egg sticker. */
  fun?: FunDTO
  /** The group's activity, which says how a payment you were waiting on was resolved. */
  feed?: FeedItem[]
}) {
  const api = useApi()
  // `done` runs as soon as the API says yes, before the group is refetched (callbacks passed to mutate wait for that).
  const resolve = useGroupMutation(groupId, async ({ id, action, done }: { id: string; action: Action; done?: () => void }) => {
    const settlement = await api.post<SettlementDTO>(`/settlements/${id}/${action}`)
    done?.()
    return settlement
  })
  const confirmed = useSettleMoment({ people, currency, fun })
  const act = (s: SettlementDTO, action: Action) => (e: MouseEvent<HTMLButtonElement>) => {
    const button = e.currentTarget
    // A confirmed payback is celebrated straight away, in its row's place, so the page moves once, as you click.
    const celebrate = () => {
      confetti(button)
      confirmed.celebrate(s, { takeFocus: true })
    }
    resolve.mutate({ id: s.id, action, done: action === 'confirm' ? celebrate : undefined })
  }

  useConfirmedWhileWaiting({ pending, feed, me, goodEgg: goodEggOf(fun), onConfirmed: confirmed.celebrate })

  const busy = (id: string, action: Action) =>
    resolve.isPending && resolve.variables?.id === id && resolve.variables.action === action

  const mine = pending.filter((s) => s.id !== confirmed.celebrating && (s.toUserId === me || s.fromUserId === me))
  return (
    <>
      {confirmed.moment}
      {mine.map((s) =>
        s.toUserId === me ? (
          <div className="need row" key={s.id}>
            <Avatar avatar={people.avatar(s.fromUserId)} mood="happy" />
            <div className="grow">
              <div className="t">
                {people.name(s.fromUserId)} says they paid you {formatMoney(s.amountCents, currency)}
              </div>
              <div className="s">Confirm once the money has arrived.</div>
            </div>
            <div className="acts">
              <button className="btn small primary" onClick={act(s, 'confirm')} disabled={resolve.isPending}>
                <BusyLabel busy={busy(s.id, 'confirm')} label="Confirming…">
                  Confirm
                </BusyLabel>
              </button>
              <button className="btn small" onClick={act(s, 'reject')} disabled={resolve.isPending}>
                <BusyLabel busy={busy(s.id, 'reject')} label="Rejecting…">
                  Reject
                </BusyLabel>
              </button>
            </div>
          </div>
        ) : (
          <div className="need row" key={s.id}>
            <Avatar avatar={people.avatar(s.toUserId)} />
            <div className="grow">
              <div className="t">Waiting for {people.name(s.toUserId)} to confirm</div>
              <div className="s">You marked {formatMoney(s.amountCents, currency)} as paid.</div>
            </div>
            <button className="btn small" onClick={act(s, 'cancel')} disabled={resolve.isPending}>
              <BusyLabel busy={busy(s.id, 'cancel')} label="Undoing…">
                Undo
              </BusyLabel>
            </button>
          </div>
        ),
      )}
      {resolve.isError && <ErrorNote error={resolve.error} />}
    </>
  )
}

/**
 * Your payments that were waiting for confirmation when you first saw them here, followed across refetches: when one
 * leaves the pending list and the activity says it was confirmed, `onConfirmed` plays the moment from your side
 * ("Bob confirmed."). One that was rejected or undone is just dropped, and nothing resolved before the page
 * opened is ever replayed. `goodEgg` (who holds it) is noted per payment as soon as it is known, as the "before".
 */
function useConfirmedWhileWaiting({
  pending,
  feed,
  me,
  goodEgg,
  onConfirmed,
}: {
  pending: SettlementDTO[]
  feed: FeedItem[] | undefined
  me: string
  goodEgg: string | null | undefined
  onConfirmed: (s: SettlementDTO, options: { goodEggBefore: string | null | undefined; confirmedBy: string }) => void
}) {
  const waiting = useRef(new Map<string, { goodEggBefore: string | null | undefined }>())
  const latest = useRef(onConfirmed)
  latest.current = onConfirmed
  useEffect(() => {
    const stillPending = new Set(pending.map((s) => s.id))
    for (const s of pending) {
      const seen = waiting.current.get(s.id)
      if (s.fromUserId !== me) continue
      if (!seen) waiting.current.set(s.id, { goodEggBefore: goodEgg })
      else if (seen.goodEggBefore === undefined) seen.goodEggBefore = goodEgg
    }
    for (const [id, seen] of waiting.current) {
      if (stillPending.has(id)) continue
      // Gone from the pending list: wait for the activity to say how it ended (the two are refetched separately).
      const now = feed?.find((i): i is Extract<FeedItem, { type: 'settlement' }> => i.type === 'settlement' && i.settlement.id === id)
      if (!now || now.settlement.status === 'pending') continue
      waiting.current.delete(id)
      if (now.settlement.status === 'confirmed') {
        latest.current(now.settlement, { goodEggBefore: seen.goodEggBefore, confirmedBy: now.settlement.toUserId })
      }
    }
  }, [pending, feed, me, goodEgg])
}
