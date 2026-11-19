import type { QuickSplitDTO } from '@squadsplit/shared'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useApi } from '../api'
import { ConfirmBar, useConfirmStep } from '../components/ConfirmBar'
import { ErrorNote } from '../components/ErrorNote'
import { PageLink, usePageNavigate } from '../components/PageLink'
import { Avatar } from '../design/Avatar'
import { CategoryIcon, UiIcon } from '../design/icons'
import { queryKeys } from '../queryKeys'
import { useSingleFlightMutation } from '../singleFlight'
import { Check } from './art'
import { clockTime, dayLabel, localToday, money, shareUrl, shortLink, titleWithPlace } from './format'
import { useStoreQuickSplit } from './quickData'

type Person = QuickSplitDTO['people'][number]

/** "Today", or "Thu 19 Nov". */
export const whenLabel = (spentOn: string) => (spentOn === localToday() ? 'Today' : dayLabel(spentOn))

/** "2 of 3 paid" (the payer counts as paid), or "All paid". */
export const progressLabel = (paid: number, of: number) => (paid === of ? 'All paid' : `${paid} of ${of} paid`)

/** Under a name: who ticked them and when, or that they paid the bill, or nothing yet. */
function tickLine(p: Person, isMe: boolean): string {
  if (p.isPayer) return isMe ? 'You paid the bill' : 'Paid the bill'
  if (!p.paidAt) return 'Not ticked yet'
  return p.paidMarkedBy === 'guest' ? `Ticked by ${p.name} · ${clockTime(p.paidAt)}` : `Marked paid by you · ${clockTime(p.paidAt)}`
}

/**
 * The payer's controls for one split (mockup 8): everyone's ticks with who ticked and when, tap to mark or unmark
 * paid, the link (Copy link, Share card, Stop sharing), Edit and Delete.
 */
export function QuickHistory({ split, onShareCard }: { split: QuickSplitDTO; onShareCard: () => void }) {
  const api = useApi()
  const store = useStoreQuickSplit()
  const navigate = usePageNavigate()
  const queryClient = useQueryClient()
  const stop = useConfirmStep()
  const remove = useConfirmStep()
  const [copied, setCopied] = useState<string | null>(null)
  const link = shareUrl(split.share.token)
  const paidCount = split.people.filter((p) => p.isPayer || p.paidAt !== null).length
  const payer = split.people.find((p) => p.isPayer)!
  const payerIsMe = split.people[0]!.id === payer.id

  const mark = useSingleFlightMutation({
    mutationFn: ({ personId, paid }: { personId: string; paid: boolean }) =>
      api.patch<QuickSplitDTO>(`/quick-splits/${split.id}/people/${personId}`, { paid }),
    onSuccess: store,
  })
  const stopSharing = useSingleFlightMutation({
    mutationFn: () => api.post<QuickSplitDTO>(`/quick-splits/${split.id}/share/stop`),
    onSuccess: (s) => {
      store(s)
      stop.close()
    },
  })
  const del = useSingleFlightMutation({
    mutationFn: () => api.del(`/quick-splits/${split.id}`),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: queryKeys.quickSplit(split.id) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.quickSplits })
      navigate('/groups', { replace: true })
    },
  })

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied('Link copied. Paste it into your chat.')
    } catch {
      setCopied(`Couldn't copy. The link is ${link}`)
    }
  }

  return (
    <section className="card" aria-label="Who has paid">
      <div className="qs-hist-h">
        <span className="tile">
          <CategoryIcon category="🍕" />
        </span>
        <div className="grow">
          <div className="t">{titleWithPlace(split)}</div>
          <div className="s">
            {whenLabel(split.spentOn)} · {payerIsMe ? 'you' : payer.name} paid {money(split, split.totalCents)}
          </div>
        </div>
        <span className={paidCount === split.people.length ? 'qs-owed done' : 'qs-owed'}>{progressLabel(paidCount, split.people.length)}</span>
      </div>
      <div className="pbar slim" aria-hidden="true">
        <i style={{ width: `${(paidCount / split.people.length) * 100}%` }} />
      </div>
      <ul className="list">
        {split.people.map((p, i) => {
          const name = i === 0 ? 'You' : p.name
          const on = p.isPayer || p.paidAt !== null
          return (
            <li className="row" key={p.id} aria-label={name}>
              <Avatar avatar={p.avatar} size="sm" mood={on ? 'happy' : 'calm'} />
              <div className="grow">
                <div className="t">{name}</div>
                <div className="s">{tickLine(p, i === 0)}</div>
              </div>
              <div className="amt-r">{money(split, p.totalCents)}</div>
              {p.isPayer ? (
                <span className="qs-tick on fixed" role="img" aria-label="Paid the bill">
                  <Check />
                </span>
              ) : (
                <button
                  type="button"
                  className={on ? 'qs-tick on' : 'qs-tick'}
                  aria-pressed={on}
                  aria-label={on ? `Untick ${p.name}` : `Mark ${p.name} paid`}
                  disabled={mark.isPending}
                  onClick={() => mark.mutate({ personId: p.id, paid: !on })}
                >
                  <Check />
                </button>
              )}
            </li>
          )
        })}
      </ul>
      <ErrorNote error={mark.error} />
      <p className="s hist-hint">Tap a tick to undo it, or to mark someone paid yourself.</p>

      <div className="link-row">
        {split.share.state === 'on' ? (
          <>
            <span className="link-on">Link on</span>
            <code>{shortLink(link)}</code>
          </>
        ) : (
          <span className="s">{split.share.revokedAt ? 'Link off · you stopped sharing' : 'Link off · it expired'}</span>
        )}
      </div>
      <div className="qs-actions start">
        {split.share.state === 'on' && (
          <button type="button" className="btn small" onClick={copyLink}>
            <UiIcon name="heart" />
            Copy link
          </button>
        )}
        <button type="button" className="btn small" onClick={onShareCard}>
          Share card
        </button>
        <PageLink to={`/quick/${split.id}/edit`} className="btn small">
          Edit
        </PageLink>
        {split.share.state === 'on' && !stop.showBar && (
          <button ref={stop.triggerRef} type="button" className="btn small ghost danger" onClick={stop.open}>
            Stop sharing
          </button>
        )}
        {!remove.showBar && (
          <button ref={remove.triggerRef} type="button" className="btn small ghost danger" onClick={remove.open}>
            Delete
          </button>
        )}
      </div>
      {copied && (
        <p className="s hist-hint" role="status">
          {copied}
        </p>
      )}
      {stop.showBar && (
        <ConfirmBar
          question="Turn the link off for everyone, straight away? It can't be turned back on."
          yes="Yes, stop sharing"
          busyLabel="Stopping…"
          busy={stopSharing.isPending}
          leaving={stop.leaving}
          onYes={() => stopSharing.mutate()}
          onCancel={stop.close}
        />
      )}
      {remove.showBar && (
        <ConfirmBar
          question="Delete this quick split and its link? This can't be undone."
          yes="Yes, delete it"
          busyLabel="Deleting…"
          busy={del.isPending}
          leaving={remove.leaving}
          onYes={() => del.mutate()}
          onCancel={remove.close}
        />
      )}
      <ErrorNote error={stopSharing.error ?? del.error} />
      <div className="note-box">
        <UiIcon name="lock" />
        <div>“Stop sharing” turns the link off straight away. The split stays here for you.</div>
      </div>
    </section>
  )
}
