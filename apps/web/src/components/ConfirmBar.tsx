import { useCallback, useEffect, useRef, useState } from 'react'
import { BusyLabel } from '../design/Busy'
import { useExitTransition } from '../design/useExitTransition'

/**
 * The open/closed state of a two-step destructive action. The bar slides in, and out again when closed; the button
 * that opened it gets focus back once the bar has gone (pass `triggerRef` to it).
 */
export function useConfirmStep() {
  const [confirming, setConfirming] = useState(false)
  const bar = useExitTransition(confirming || null)
  const returnFocus = useRef(false)
  const triggerRef = useCallback((button: HTMLButtonElement | null) => {
    if (button && returnFocus.current) button.focus()
    returnFocus.current = false
  }, [])
  return {
    /** Whether the bar is on screen (it stays a moment while it animates out). */
    showBar: bar.shown !== null,
    leaving: bar.leaving,
    triggerRef,
    open: () => setConfirming(true),
    close: () => {
      returnFocus.current = true
      setConfirming(false)
    },
  }
}

/** The second step of a destructive action: a question, a "yes" button and Cancel (focused when it opens). */
export function ConfirmBar({
  question,
  yes,
  busyLabel,
  busy,
  leaving = false,
  onYes,
  onCancel,
}: {
  question: string
  yes: string
  /** What the "yes" button says while the action waits on the server, like "Leaving…". */
  busyLabel: string
  busy: boolean
  /** Animating out (see useConfirmStep). */
  leaving?: boolean
  onYes: () => void
  onCancel: () => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => cancelRef.current?.focus(), [])
  return (
    <div className={leaving ? 'confirm out' : 'confirm'}>
      <span className="grow">{question}</span>
      <button className="btn small danger" onClick={onYes} disabled={busy || leaving}>
        <BusyLabel busy={busy} label={busyLabel}>
          {yes}
        </BusyLabel>
      </button>
      <button ref={cancelRef} className="btn small ghost" onClick={onCancel} disabled={busy || leaving}>
        Cancel
      </button>
    </div>
  )
}
