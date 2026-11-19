import { useAuth } from '@clerk/react'
import { defaultAvatar, type QuickSplitDTO, type QuickSplitInput } from '@squadsplit/shared'
import { useEffect, useRef, useState } from 'react'
import { useBlocker, useLocation, useNavigate, useParams } from 'react-router'
import { useApi } from '../api'
import { ConfirmBar } from '../components/ConfirmBar'
import { ErrorCard } from '../components/ErrorCard'
import { ErrorNote } from '../components/ErrorNote'
import { PageLink, usePageNavigate } from '../components/PageLink'
import { BusyLabel } from '../design/Busy'
import { SkText } from '../design/Skeleton'
import { parseMemberName } from '../memberName'
import { useSingleFlightMutation } from '../singleFlight'
import { useMe } from '../useProfileRefresh'
import { AssignStep } from './AssignStep'
import { BillStep } from './BillStep'
import { billProblem, draftFromSplit, newQuickDraft, peopleProblem, reserveKeys, toInput, type QuickDraft } from './draft'
import { loadQuickDraft, newDraftId, saveQuickDraft } from './draftStore'
import { localToday } from './format'
import { PeopleStep } from './PeopleStep'
import { useQuickSplit, useStoreQuickSplit } from './quickData'
import { StepBar, type Step } from './StepBar'
import './quick.css'

/**
 * The first word of your profile name, for the card (the link shows first names only), if it is a name the card takes
 * (24 characters, no emoji); otherwise nothing, for you to type one. You can change it either way.
 */
const cardName = (displayName: string | undefined) => parseMemberName(displayName?.trim().split(/\s+/)[0] ?? '') ?? ''

/** Each step's `?step=` in the URL (none for the Bill). */
const STEP_PARAM = ['', 'people', 'assign'] as const
const stepFrom = (search: string): Step => Math.max(0, STEP_PARAM.indexOf(new URLSearchParams(search).get('step') as never)) as Step
const searchFor = (step: Step) => (step === 0 ? '' : `?step=${STEP_PARAM[step]}`)

/** What a history entry of the flow carries: its draft, and whether Next pushed it (so the step before is Back). */
interface FlowEntry {
  draftId?: string
  viaNext?: boolean
}

export const LEAVE_QUESTION = "Leave this bill? Your dishes won't be saved."

/**
 * The Bill → People → Assign flow, for a new split or an edit. Each step is its own history entry (`?step=`), so the
 * phone's Back and swipe-back go to the step before. The draft is kept in this tab (see draftStore) under the id the
 * entries carry, so coming back to them restores it; leaving with changes asks first. Saving lands on the split's
 * share card, its own entry too: Back from there returns to Assign, and saving again updates the same split.
 */
function Flow({ initial, splitId }: { initial: QuickDraft; splitId?: string }) {
  const api = useApi()
  const location = useLocation()
  const navigate = useNavigate()
  const pageNavigate = usePageNavigate()
  const store = useStoreQuickSplit()
  const entry = (location.state ?? {}) as FlowEntry
  // A fresh visit (the Quick split button, Edit) starts its own draft; Back, Forward and a reload come back to theirs.
  const [draftId] = useState(() => entry.draftId ?? newDraftId())
  const [kept] = useState(() => (entry.draftId ? loadQuickDraft(entry.draftId) : null))
  const [start] = useState(() => kept?.start ?? initial)
  const [draft, setDraftState] = useState(() => {
    const d = kept?.draft ?? initial
    reserveKeys(d)
    return d
  })
  const savedId = kept?.savedId ?? splitId
  const [problem, setProblem] = useState<string | null>(null)
  // A change answers whatever stopped the last Next, so its message goes.
  const setDraft: typeof setDraftState = (update) => {
    setProblem(null)
    setDraftState(update)
  }
  const dirty = JSON.stringify(draft) !== JSON.stringify(start)
  useEffect(() => saveQuickDraft(draftId, { start, draft, savedId }), [draftId, start, draft, savedId])
  // The entry this draft opened on carries its id from now on.
  useEffect(() => {
    if (!entry.draftId) navigate({ search: location.search }, { replace: true, state: { draftId } satisfies FlowEntry })
  }, []) // once, on the entry it opened on

  // The step in the URL, but never past one that isn't ready (a step opened with nothing to show lands earlier).
  const ready: Step = billProblem(draft) ? 0 : peopleProblem(draft) ? 1 : 2
  const wanted = stepFrom(location.search)
  const step = Math.min(wanted, ready) as Step
  useEffect(() => {
    if (wanted > ready) navigate({ search: searchFor(ready) }, { replace: true, state: { draftId } satisfies FlowEntry })
  }, [wanted, ready, draftId, navigate])

  // Leaving the flow with changes asks first; saving doesn't.
  const leaving = useRef(false)
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !leaving.current && currentLocation.pathname !== nextLocation.pathname)
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const save = useSingleFlightMutation({
    mutationFn: (input: QuickSplitInput) => (savedId ? api.put<QuickSplitDTO>(`/quick-splits/${savedId}`, input) : api.post<QuickSplitDTO>('/quick-splits', input)),
    onSuccess: (saved) => {
      store(saved)
      // Back from the card comes here again, as the saved split (everyone with their id), to save as an edit.
      const asSaved = draftFromSplit(saved)
      saveQuickDraft(draftId, { start: asSaved, draft: asSaved, savedId: saved.id })
      leaving.current = true
      pageNavigate(`/quick/${saved.id}`, { state: { fresh: !splitId } })
    },
  })

  function goTo(to: Step) {
    setProblem(null)
    if (to === step) return
    // One step back along the entries Next made is the browser's own Back; anything else replaces this entry.
    if (to === step - 1 && entry.viaNext) navigate(-1)
    else navigate({ search: searchFor(to) }, { replace: true, state: { draftId } satisfies FlowEntry })
  }

  function next() {
    const blocked = step === 0 ? billProblem(draft) : step === 1 ? peopleProblem(draft) : null
    if (blocked) return setProblem(blocked)
    setProblem(null)
    if (step < 2) return navigate({ search: searchFor((step + 1) as Step) }, { state: { draftId, viaNext: true } satisfies FlowEntry })
    const out = toInput(draft)
    if ('problem' in out) return setProblem(out.problem)
    save.mutate(out.input)
  }

  const cancelTo = savedId ? `/quick/${savedId}` : '/groups'
  return (
    <main className="narrow page qs-page">
      <div className="qs-head">
        <div className="grow">
          <h2>{savedId ? 'Edit quick split' : 'Quick split'}</h2>
          <span className="sub">{draft.title.trim() || 'One bill, no group'}</span>
        </div>
        <PageLink to={cancelTo} className="btn small ghost">
          Cancel
        </PageLink>
      </div>
      <StepBar now={step} onPick={goTo} />
      {step === 0 && <BillStep draft={draft} setDraft={setDraft} />}
      {step === 1 && <PeopleStep draft={draft} setDraft={setDraft} />}
      {step === 2 && <AssignStep draft={draft} setDraft={setDraft} />}
      {problem ? (
        <p className="err" role="alert">
          {problem}
        </p>
      ) : (
        <ErrorNote error={save.error} />
      )}
      <div className="form-f">
        {step > 0 && (
          <button type="button" className="btn ghost" onClick={() => goTo((step - 1) as Step)}>
            Back
          </button>
        )}
        <button type="button" className="btn primary" onClick={next} disabled={save.isPending}>
          <BusyLabel busy={save.isPending} label="Saving…">
            {step === 0 ? 'Next: who’s in?' : step === 1 ? 'Next: who had what?' : savedId ? 'Save changes' : 'Make the share card'}
          </BusyLabel>
        </button>
      </div>
      {blocker.state === 'blocked' && (
        <div className="leave-bar">
          <ConfirmBar
            question={LEAVE_QUESTION}
            yes="Leave"
            no="Keep editing"
            busyLabel="Leaving…"
            busy={false}
            onYes={() => blocker.proceed()}
            onCancel={() => blocker.reset()}
          />
        </div>
      )}
    </main>
  )
}

/** `/quick/new`: you paid, on your profile look, with your profile name on the card. */
export function NewQuickSplit() {
  const { userId } = useAuth()
  const me = useMe()
  if (me.isPending) {
    return (
      <main className="narrow page qs-page" aria-busy="true">
        <h2>
          <SkText w={160} />
        </h2>
      </main>
    )
  }
  const look = me.data?.profileAvatar ?? defaultAvatar(userId ?? '')
  return <Flow initial={newQuickDraft(cardName(me.data?.displayName), localToday(), look)} />
}

/** `/quick/:splitId/edit`: back into the flow with the split as saved; saving replaces it. */
export function EditQuickSplit() {
  const id = useParams().splitId!
  const split = useQuickSplit(id)
  if (split.isPending) {
    return (
      <main className="narrow page qs-page" aria-busy="true">
        <h2>
          <SkText w={160} />
        </h2>
      </main>
    )
  }
  if (split.isError) {
    return (
      <main className="narrow page">
        <ErrorCard error={split.error} onRetry={() => void split.refetch()} />
      </main>
    )
  }
  return <Flow initial={draftFromSplit(split.data)} splitId={split.data.id} />
}
