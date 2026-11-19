import type { PublicQuickSplitDTO } from '@squadsplit/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { ApiError, publicApi } from '../api'
import { LogoPup } from '../components/Logo'
import { Avatar } from '../design/Avatar'
import { BusyLabel } from '../design/Busy'
import { Skeleton } from '../design/Skeleton'
import { UiIcon } from '../design/icons'
import { queryKeys } from '../queryKeys'
import { Check, PaidStamp, PaidTick } from './art'
import { chargesMath, clockTime, money } from './format'
import { CardHeader, dishesLine } from './ShareCard'
import './quick.css'

// The share link: anyone with it opens it with no account and no sign-in (it never touches Clerk). They see first
// names and amounts, tap their own name, and tick "I've paid". The payer sees every tick and can fix it.

/** Ticks from others show up live: every 30 seconds, and when the tab comes back. */
const REFRESH_MS = 30_000

/** "Which one are you?" is remembered on this phone, per link. Storage can be blocked; it's a convenience only. */
const pickKey = (token: string) => `squadsplit:quick-split:${token}:me`
function readPick(token: string): string | null {
  try {
    return localStorage.getItem(pickKey(token))
  } catch {
    return null
  }
}
function writePick(token: string, personId: string | null) {
  try {
    if (personId) localStorage.setItem(pickKey(token), personId)
    else localStorage.removeItem(pickKey(token))
  } catch {
    // Blocked storage: the pick lasts until the page closes.
  }
}

/** Tells search engines to leave the page alone (the _headers file sends X-Robots-Tag: noindex too). */
function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex'
    document.head.appendChild(meta)
    return () => meta.remove()
  }, [])
}

function TopStrip() {
  return (
    <header className="pub-top">
      <a href="/" className="logo">
        <span className="mark">
          <LogoPup />
        </span>
        <b>SquadSplit</b>
      </a>
      <span className="pub-pill">No sign-in needed</span>
    </header>
  )
}

/** The page instead of the split: a link that's off (410), unknown (404), or a read that failed. */
function ProblemCard({ error }: { error: unknown }) {
  const status = error instanceof ApiError ? error.status : 0
  // A stopped or expired link: the API's message names who to ask.
  const message =
    error instanceof ApiError && status === 410
      ? error.message
      : status === 404
        ? "We can't find this split. Check you copied the whole link, or ask whoever paid for it again."
        : "Can't load this split right now. Check your connection and try again."
  return (
    <section className="card join" role="alert">
      <div className="hero-mark shiver">
        <LogoPup mood="nervous" />
      </div>
      <p>{message}</p>
      {status !== 410 && status !== 404 && (
        <button className="btn primary" onClick={() => window.location.reload()}>
          Try again
        </button>
      )}
    </section>
  )
}

const tickError = (err: unknown) =>
  err instanceof ApiError && err.status === 429
    ? 'Lots of ticks on this link just now. Wait a little and try again.'
    : err instanceof ApiError && err.status === 410
      ? err.message
      : "Couldn't save that. Check your connection and try again."

type Person = PublicQuickSplitDTO['people'][number]

/** `/s/:token`: the share link page. */
export function SharedSplitPage() {
  const token = useParams().token!
  useNoIndex()
  const queryClient = useQueryClient()
  const split = useQuery({
    queryKey: queryKeys.sharedSplit(token),
    queryFn: () => publicApi.get<PublicQuickSplitDTO>(`/s/${token}`),
    refetchInterval: REFRESH_MS,
    refetchOnWindowFocus: true,
  })
  const [pick, setPick] = useState<string | null>(() => readPick(token))
  const [thanked, setThanked] = useState<string | null>(null)
  const tick = useMutation({
    mutationFn: ({ personId, paid }: { personId: string; paid: boolean }) =>
      publicApi.post<PublicQuickSplitDTO>(`/s/${token}/people/${personId}/paid`, { paid }),
    onSuccess: (data, { personId, paid }) => {
      queryClient.setQueryData(queryKeys.sharedSplit(token), data)
      setThanked(paid ? personId : null)
    },
  })

  function choose(personId: string | null) {
    setPick(personId)
    setThanked(null)
    tick.reset()
    writePick(token, personId)
  }

  const s = split.data
  // A pick that is no longer a guest in the split (removed, or now the payer) is forgotten.
  const me = s?.people.find((p) => p.id === pick && p.id !== s.payerId) ?? null
  const paidCount = s ? s.people.filter((p) => p.id === s.payerId || p.paidAt !== null).length : 0
  const allPaid = s !== undefined && paidCount === s.people.length

  return (
    <div className="pub-wrap">
      <TopStrip />
      <main className="narrow page qs-page pub">
        {split.isPending && (
          <div role="status" aria-label="Loading the split">
            <Skeleton h={480} r={22} />
          </div>
        )}
        {split.isError && !s && <ProblemCard error={split.error} />}
        {s && (
          <>
            {thanked && me && thanked === me.id && (
              <div className="qs-toast" role="status">
                <Check />
                Thanks, {me.name}. {s.payerName} can see you’ve paid.
              </div>
            )}
            <section className="qs-card pub-card" aria-label="The split">
              <CardHeader split={s} />
              <div className="pub-progress">
                <span>{allPaid ? "Everyone's paid" : `${paidCount} of ${s.people.length} paid`}</span>
                <div className="pbar" aria-hidden="true">
                  <i style={{ width: `${(paidCount / s.people.length) * 100}%` }} />
                </div>
                {allPaid && <PaidStamp />}
              </div>
              {!me && <div className="pub-ask">Which one are you?</div>}
              <ul className="pub-rows">
                {s.people.map((p) => (
                  <PersonRow
                    key={p.id}
                    split={s}
                    person={p}
                    picked={me?.id === p.id}
                    choosing={!me}
                    busy={tick.isPending}
                    onPick={() => choose(p.id)}
                    onNotMe={() => choose(null)}
                    onPaid={(paid) => tick.mutate({ personId: p.id, paid })}
                  />
                ))}
              </ul>
              {tick.isError && (
                <p className="err" role="alert">
                  {tickError(tick.error)}
                </p>
              )}
              <div className="qs-math">{chargesMath(s)}.</div>
            </section>
            <div className="note-box honour">
              <UiIcon name="heart" />
              <div>Tap your own name. {s.payerName} can see who's ticked, and can fix a wrong tick.</div>
            </div>
            <p className="qs-hint">Shared by {s.payerName} with a private link. Only people with the link can see this.</p>
          </>
        )}
      </main>
    </div>
  )
}

function PersonRow({
  split,
  person: p,
  picked,
  choosing,
  busy,
  onPick,
  onNotMe,
  onPaid,
}: {
  split: PublicQuickSplitDTO
  person: Person
  picked: boolean
  choosing: boolean
  busy: boolean
  onPick: () => void
  onNotMe: () => void
  onPaid: (paid: boolean) => void
}) {
  const isPayer = p.id === split.payerId
  const paid = isPayer || p.paidAt !== null
  const main = (
    <>
      <Avatar avatar={p.avatar} mood={paid ? 'happy' : picked ? 'nervous' : 'calm'} />
      <span className="grow">
        <span className="nm">
          {p.name}
          {picked && <em className="me-tag">That’s me</em>}
        </span>
        <span className="dishes-l">{dishesLine(split, p.dishes)}</span>
      </span>
      <b>{money(split, p.totalCents)}</b>
    </>
  )
  return (
    <li className={['pub-row', picked && 'picked', paid && 'is-paid'].filter(Boolean).join(' ')} aria-label={p.name}>
      {choosing && !isPayer ? (
        <button type="button" className="pub-main" onClick={onPick}>
          {main}
        </button>
      ) : (
        <div className="pub-main">{main}</div>
      )}
      {isPayer ? (
        <div className="pub-foot">
          <span className="pub-status ok">
            <PaidTick />
            Paid the bill
          </span>
        </div>
      ) : p.paidAt !== null ? (
        <div className="pub-foot">
          <span className="pub-status ok">
            <PaidTick />
            Paid · {clockTime(p.paidAt)}
          </span>
          {picked && (
            <button type="button" className="pub-undo" onClick={() => onPaid(false)} disabled={busy}>
              Undo
            </button>
          )}
        </div>
      ) : (
        !picked && (
          <div className="pub-foot">
            <span className="pub-status">Not ticked yet</span>
          </div>
        )
      )}
      {picked && p.paidAt === null && (
        <button type="button" className="btn primary pub-paid" onClick={() => onPaid(true)} disabled={busy}>
          <BusyLabel busy={busy} label="Saving…">
            <Check />
            I’ve paid {split.payerName} {money(split, p.totalCents)}
          </BusyLabel>
        </button>
      )}
      {picked && (
        <button type="button" className="pub-undo not-me" onClick={onNotMe}>
          Not you?
        </button>
      )}
    </li>
  )
}
