import { formatMoney, type SettlementDTO } from '@squadsplit/shared'
import { useState, type MouseEvent } from 'react'
import { useApi } from '../api'
import { Avatar } from '../design/Avatar'
import { BusyLabel } from '../design/Busy'
import { confetti } from '../design/confetti'
import { useGroupMutation, type People } from '../groupData'
import { ErrorNote } from './ErrorNote'
import { SettleMoment } from './SettleMoment'

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
}: {
  groupId: string
  pending: SettlementDTO[]
  me: string
  people: People
  currency: string
}) {
  const api = useApi()
  const resolve = useGroupMutation(groupId, ({ id, action }: { id: string; action: Action }) =>
    api.post<SettlementDTO>(`/settlements/${id}/${action}`),
  )
  /** The payback you just confirmed, celebrated until you close it. */
  const [confirmed, setConfirmed] = useState<SettlementDTO | null>(null)
  const act = (s: SettlementDTO, action: Action) => (e: MouseEvent<HTMLButtonElement>) => {
    const button = e.currentTarget
    resolve.mutate(
      { id: s.id, action },
      {
        onSuccess: () => {
          if (action !== 'confirm') return
          confetti(button)
          setConfirmed(s)
        },
      },
    )
  }

  const busy = (id: string, action: Action) =>
    resolve.isPending && resolve.variables?.id === id && resolve.variables.action === action

  const mine = pending.filter((s) => s.toUserId === me || s.fromUserId === me)
  return (
    <>
      {confirmed && (
        <SettleMoment settlement={confirmed} me={me} people={people} currency={currency} onClose={() => setConfirmed(null)} />
      )}
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
