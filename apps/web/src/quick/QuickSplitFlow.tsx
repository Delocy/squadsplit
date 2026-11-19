import { useAuth } from '@clerk/react'
import { defaultAvatar, type QuickSplitDTO, type QuickSplitInput } from '@squadsplit/shared'
import { useState } from 'react'
import { useParams } from 'react-router'
import { useApi } from '../api'
import { ErrorNote } from '../components/ErrorNote'
import { PageLink, usePageNavigate } from '../components/PageLink'
import { BusyLabel } from '../design/Busy'
import { SkText } from '../design/Skeleton'
import { parseMemberName } from '../memberName'
import { useSingleFlightMutation } from '../singleFlight'
import { useMe } from '../useProfileRefresh'
import { AssignStep } from './AssignStep'
import { BillStep } from './BillStep'
import { billProblem, draftFromSplit, newQuickDraft, peopleProblem, toInput, type QuickDraft } from './draft'
import { PeopleStep } from './PeopleStep'
import { useQuickSplit, useStoreQuickSplit } from './quickData'
import { StepBar, type Step } from './StepBar'
import './quick.css'

const today = () => new Date().toLocaleDateString('en-CA') // YYYY-MM-DD in the local time zone

/** Your profile name as it can go on the card (24 characters, no emoji), or nothing for you to type it. */
const cardName = (displayName: string | undefined) =>
  (displayName && (parseMemberName(displayName) ?? parseMemberName(displayName.split(' ')[0]!))) || ''

/**
 * The Bill → People → Assign flow, for a new split or an edit. The draft lives in this page's state only: leaving
 * loses it. Saving lands on the split's share card.
 */
function Flow({ initial, split }: { initial: QuickDraft; split?: QuickSplitDTO }) {
  const api = useApi()
  const navigate = usePageNavigate()
  const store = useStoreQuickSplit()
  const [draft, setDraftState] = useState(initial)
  const [step, setStep] = useState<Step>(0)
  const [problem, setProblem] = useState<string | null>(null)
  // A change answers whatever stopped the last Next, so its message goes.
  const setDraft: typeof setDraftState = (update) => {
    setProblem(null)
    setDraftState(update)
  }

  const save = useSingleFlightMutation({
    mutationFn: (input: QuickSplitInput) => (split ? api.put<QuickSplitDTO>(`/quick-splits/${split.id}`, input) : api.post<QuickSplitDTO>('/quick-splits', input)),
    onSuccess: (saved) => {
      store(saved)
      navigate(`/quick/${saved.id}`, { replace: true, state: { fresh: !split } })
    },
  })

  function go(to: Step) {
    setProblem(null)
    setStep(to)
  }

  function next() {
    const blocked = step === 0 ? billProblem(draft) : step === 1 ? peopleProblem(draft) : null
    if (blocked) return setProblem(blocked)
    if (step < 2) return go((step + 1) as Step)
    const out = toInput(draft)
    if ('problem' in out) return setProblem(out.problem)
    setProblem(null)
    save.mutate(out.input)
  }

  const cancelTo = split ? `/quick/${split.id}` : '/groups'
  return (
    <main className="narrow page qs-page">
      <div className="qs-head">
        <div className="grow">
          <h2>{split ? 'Edit quick split' : 'Quick split'}</h2>
          <span className="sub">{draft.title.trim() || 'One bill, no group'}</span>
        </div>
        <PageLink to={cancelTo} className="btn small ghost">
          Cancel
        </PageLink>
      </div>
      <StepBar now={step} onPick={go} />
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
          <button type="button" className="btn ghost" onClick={() => go((step - 1) as Step)}>
            Back
          </button>
        )}
        <button type="button" className="btn primary" onClick={next} disabled={save.isPending}>
          <BusyLabel busy={save.isPending} label="Saving…">
            {step === 0 ? 'Next: who’s in?' : step === 1 ? 'Next: who had what?' : split ? 'Save changes' : 'Make the share card'}
          </BusyLabel>
        </button>
      </div>
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
  return <Flow initial={newQuickDraft(cardName(me.data?.displayName), today(), look)} />
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
        <ErrorNote error={split.error} />
      </main>
    )
  }
  return <Flow initial={draftFromSplit(split.data)} split={split.data} />
}
