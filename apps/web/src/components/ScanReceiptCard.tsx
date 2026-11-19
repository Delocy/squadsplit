import type { Currency } from '@squadsplit/shared'
import { useRef, useState, type ChangeEvent } from 'react'
import { useApi } from '../api'
import { BusyLabel } from '../design/Busy'
import { UiIcon } from '../design/icons'
import { UNREADABLE_BANNER, scanBanner } from '../receipt/banner'
import { scanReceipt, type ReceiptScan } from '../receipt/scanReceipt'
import { ErrorNote } from './ErrorNote'

type State =
  | { phase: 'idle' }
  | { phase: 'reading' }
  | { phase: 'confirm'; scan: ReceiptScan }
  | { phase: 'banner'; text: string }
  | { phase: 'error'; error: unknown }

/**
 * The photo types offered. An explicit list rather than image/*, which some desktop and embedded pickers (macOS,
 * Electron) apply badly, greying out .jpeg files. Whether a file really is a photo is decided by decoding it.
 */
const PHOTO_TYPES = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif'

/**
 * The receipt card at the top of a new expense: take a photo (camera, or one from the gallery), read it, and hand
 * the items to `onScan`, which fills the form in By item. Asks first if the user has entered amounts or items
 * already. Never saves anything.
 */
export function ScanReceiptCard({
  groupId,
  currency,
  hasEnteredAmounts,
  onScan,
}: {
  groupId: string
  currency: Currency
  /** Whether a scan would replace something the user typed. */
  hasEnteredAmounts: boolean
  onScan: (scan: ReceiptScan) => void
}) {
  const api = useApi()
  const [state, setState] = useState<State>({ phase: 'idle' })
  // Read when the scan comes back, so whatever was typed while it was reading counts too.
  const enteredRef = useRef(hasEnteredAmounts)
  enteredRef.current = hasEnteredAmounts
  const reading = state.phase === 'reading'

  function apply(scan: ReceiptScan) {
    onScan(scan)
    setState({ phase: 'banner', text: scanBanner(scan, currency) })
  }

  async function onPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // so the same photo can be chosen again
    if (!file) return
    setState({ phase: 'reading' })
    try {
      const outcome = await scanReceipt(api, groupId, file)
      if (outcome.kind === 'unreadable') setState({ phase: 'banner', text: UNREADABLE_BANNER })
      else if (enteredRef.current) setState({ phase: 'confirm', scan: outcome.scan })
      else apply(outcome.scan)
    } catch (error) {
      setState({ phase: 'error', error })
    }
  }

  return (
    <section className="scan-card" aria-label="Scan a receipt">
      <span className="scan-ic">
        <UiIcon name="receipt" />
      </span>
      <div className="scan-main">
        <p className="scan-lede">Got a receipt? Scan it and we'll fill in the items.</p>
        <div className="scan-actions">
          {/* While it reads, the buttons stay where they are (disabled), so nothing below moves. */}
          <label className={reading ? 'btn small primary busy' : 'btn small primary'}>
            <BusyLabel busy={reading} label="Reading…">
              <UiIcon name="receipt" />
              Scan receipt
            </BusyLabel>
            <input className="sr-only" type="file" accept={PHOTO_TYPES} capture="environment" onChange={onPhoto} disabled={reading} />
          </label>
          <label className={reading ? 'btn small ghost busy' : 'btn small ghost'}>
            Pick a photo
            <input className="sr-only" type="file" accept={PHOTO_TYPES} onChange={onPhoto} disabled={reading} />
          </label>
        </div>
        {reading && (
          <p className="sr-only" role="status">
            Reading your receipt…
          </p>
        )}
        {state.phase === 'confirm' && (
          <div className="scan-confirm">
            <p>Replace what you've entered with the receipt?</p>
            <button type="button" className="btn small primary" onClick={() => apply(state.scan)}>
              Replace
            </button>
            <button type="button" className="btn small ghost" onClick={() => setState({ phase: 'idle' })}>
              Keep mine
            </button>
          </div>
        )}
        {state.phase === 'banner' && (
          <p className="scan-banner" role="status">
            {state.text}
          </p>
        )}
        {state.phase === 'error' && <ErrorNote error={state.error} />}
      </div>
    </section>
  )
}
