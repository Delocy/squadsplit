import { formatMoney, type FunDTO, type SettlementDTO } from '@squadsplit/shared'
import type { MouseEvent } from 'react'
import { useApi } from '../api'
import { Avatar } from '../design/Avatar'
import { BusyLabel } from '../design/Busy'
import { confetti } from '../design/confetti'
import { useGroupMutation, type People } from '../groupData'
import { ErrorNote } from './ErrorNote'
import { useSettleMoment } from './SettleMoment'

type Action = 'confirm' | 'reject' | 'cancel'

/**
 * Pending settlements that involve you: as the creditor you confirm or reject them,
 * as the debtor you can undo (cancel) them while they wait. Confirming one plays the settle-up moment.
 */
export function PendingActions({
  groupId,
  pending,
  me,
  people,
  currency,
  fun,
}: {
  groupId: string
  pending: SettlementDTO[]
  me: string
  people: People
  currency: string
  /** The group's titles, to tell when a payback earns the payer the Good Egg sticker. */
  fun?: FunDTO
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
      confirmed.celebrate(s)
    }
    resolve.mutate({ id: s.id, action, done: action === 'confirm' ? celebrate : undefined })
  }

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
