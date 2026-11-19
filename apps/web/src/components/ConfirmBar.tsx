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

/**
 * The second step of a destructive action: the question on its own line, then Cancel (focused when it opens) and the
 * filled "yes" button in a row under it.
 */
export function ConfirmBar({
  question,
  yes,
  no = 'Cancel',
  busyLabel,
  busy,
  leaving = false,
  onYes,
  onCancel,
}: {
  question: string
  yes: string
  /** The button that backs out, "Cancel" unless the question reads better with something else ("Keep editing"). */
  no?: string
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
    <div className={leaving ? 'confirm out' : 'confirm'} role="group" aria-label={question}>
      <p className="confirm-q">{question}</p>
      <div className="confirm-acts">
        <button ref={cancelRef} type="button" className="btn ghost" onClick={onCancel} disabled={busy || leaving}>
          {no}
        </button>
        <button type="button" className="btn danger solid" onClick={onYes} disabled={busy || leaving}>
          <BusyLabel busy={busy} label={busyLabel}>
            {yes}
          </BusyLabel>
        </button>
      </div>
    </div>
  )
}
