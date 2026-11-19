import { formatMoney, type SettlementDTO } from '@squadsplit/shared'
import type { MouseEvent } from 'react'
import { useApi } from '../api'
import { Avatar } from '../design/Avatar'
import { confetti } from '../design/confetti'
import { useGroupMutation, type People } from '../groupData'
import { ErrorNote } from './ErrorNote'

type Action = 'confirm' | 'reject' | 'cancel'

/**
 * Pending settlements that involve you: as the creditor you confirm or reject them,
 * as the debtor you can undo (cancel) them while they wait.
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
  const act = (id: string, action: Action) => (e: MouseEvent<HTMLButtonElement>) => {
    const button = e.currentTarget
    resolve.mutate({ id, action }, { onSuccess: () => action === 'confirm' && confetti(button) })
  }

  const mine = pending.filter((s) => s.toUserId === me || s.fromUserId === me)
  return (
    <>
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
              <button className="btn small primary" onClick={act(s.id, 'confirm')} disabled={resolve.isPending}>
                Confirm
              </button>
              <button className="btn small" onClick={act(s.id, 'reject')} disabled={resolve.isPending}>
                Reject
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
            <button className="btn small" onClick={act(s.id, 'cancel')} disabled={resolve.isPending}>
              Undo
            </button>
          </div>
        ),
      )}
      {resolve.isError && <ErrorNote error={resolve.error} />}
    </>
  )
}
