import { useLocation, useParams } from 'react-router'
import { ErrorNote } from '../components/ErrorNote'
import { Skeleton } from '../design/Skeleton'
import { shareUrl } from './format'
import { useQuickSplit } from './quickData'
import { StepBar } from './StepBar'
import { ShareCardWithActions } from './ShareCard'
import './quick.css'

/** `/quick/:splitId`: the share card, and the payer's view of who has paid. Just saved, it shows as the flow's last step. */
export function QuickSplitPage() {
  const id = useParams().splitId!
  const fresh = (useLocation().state as { fresh?: boolean } | null)?.fresh === true
  const split = useQuickSplit(id)

  return (
    <main className="narrow page qs-page">
      {fresh && <StepBar now={3} />}
      {split.isPending && (
        <div role="status" aria-label="Loading the quick split">
          <Skeleton h={520} r={22} />
        </div>
      )}
      {split.isError && <ErrorNote error={split.error} />}
      {split.data && <ShareCardWithActions split={split.data} link={shareUrl(split.data.share.token)} />}
    </main>
  )
}
