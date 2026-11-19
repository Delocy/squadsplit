import { BusyLabel } from '../design/Busy'

/** The second step of a destructive action: a question, a "yes" button and Cancel. */
export function ConfirmBar({
  question,
  yes,
  busyLabel,
  busy,
  onYes,
  onCancel,
}: {
  question: string
  yes: string
  /** What the "yes" button says while the action waits on the server, like "Leaving…". */
  busyLabel: string
  busy: boolean
  onYes: () => void
  onCancel: () => void
}) {
  return (
    <div className="confirm">
      <span className="grow">{question}</span>
      <button className="btn small danger" onClick={onYes} disabled={busy}>
        <BusyLabel busy={busy} label={busyLabel}>
          {yes}
        </BusyLabel>
      </button>
      <button className="btn small ghost" onClick={onCancel} disabled={busy}>
        Cancel
      </button>
    </div>
  )
}
