import type { Currency } from '@squadsplit/shared'
import { useRef, useState, type ChangeEvent } from 'react'
import { useApi } from '../api'
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
 * "Scan receipt" in the By item section: takes a photo (camera, or one from the gallery), reads it and hands the
 * items to `onScan` to fill the form. Asks first if the user has typed items already. Never saves anything.
 */
export function ScanReceiptButton({
  groupId,
  currency,
  hasTypedItems,
  onScan,
}: {
  groupId: string
  currency: Currency
  hasTypedItems: boolean
  onScan: (scan: ReceiptScan) => void
}) {
  const api = useApi()
  const [state, setState] = useState<State>({ phase: 'idle' })
  // Read when the scan comes back, so items typed while it was reading count too.
  const typedRef = useRef(hasTypedItems)
  typedRef.current = hasTypedItems

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
      else if (typedRef.current) setState({ phase: 'confirm', scan: outcome.scan })
      else apply(outcome.scan)
    } catch (error) {
      setState({ phase: 'error', error })
    }
  }

  return (
    <div className="scan">
      {state.phase === 'reading' ? (
        <p className="scan-reading" role="status">
          <span className="scan-spin">
            <UiIcon name="receipt" />
          </span>
          Reading your receipt…
        </p>
      ) : (
        <div className="scan-actions">
          <label className="btn small">
            <UiIcon name="receipt" />
            Scan receipt
            <input className="sr-only" type="file" accept={PHOTO_TYPES} capture="environment" onChange={onPhoto} />
          </label>
          <label className="btn small ghost">
            Pick a photo
            <input className="sr-only" type="file" accept={PHOTO_TYPES} onChange={onPhoto} />
          </label>
        </div>
      )}
      {state.phase === 'confirm' && (
        <div className="scan-confirm">
          <p>Replace the items you typed with the {state.scan.items.length} from the receipt?</p>
          <button type="button" className="btn small primary" onClick={() => apply(state.scan)}>
            Replace items
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
  )
}
