import { useRef } from 'react'
import { useLocation, useParams } from 'react-router'
import { ErrorCard } from '../components/ErrorCard'
import { Skeleton } from '../design/Skeleton'
import { shareUrl } from './format'
import { QuickHistory } from './QuickHistory'
import { useQuickSplit } from './quickData'
import { ShareCardWithActions } from './ShareCard'
import { StepBar } from './StepBar'
import './quick.css'

/**
 * `/quick/:splitId`: the payer's view of one split: who has paid (mockup 8) and the share card. Just saved, it shows
 * as the flow's last step, with the card first.
 */
export function QuickSplitPage() {
  const id = useParams().splitId!
  const fresh = (useLocation().state as { fresh?: boolean } | null)?.fresh === true
  const split = useQuickSplit(id)
  const cardRef = useRef<HTMLDivElement>(null)

  if (split.isPending) {
    return (
      <main className="narrow page qs-page">
        <div role="status" aria-label="Loading the quick split">
          <Skeleton h={520} r={22} />
        </div>
      </main>
    )
  }
  if (split.isError) {
    return (
      <main className="narrow page qs-page">
        <ErrorCard error={split.error} onRetry={() => void split.refetch()} />
      </main>
    )
  }

  const card = (
    <div ref={cardRef} className="qs-page" key="card">
      <ShareCardWithActions split={split.data} link={split.data.share.state === 'on' ? shareUrl(split.data.share.token) : null} />
    </div>
  )
  const history = <QuickHistory key="history" split={split.data} onShareCard={() => cardRef.current?.scrollIntoView({ behavior: 'smooth' })} />
  return (
    <main className="narrow page qs-page">
      {fresh && <StepBar now={3} />}
      {fresh ? [card, history] : [history, card]}
    </main>
  )
}
