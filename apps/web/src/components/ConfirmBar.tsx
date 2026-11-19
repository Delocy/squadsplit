/** The second step of a destructive action: a question, a "yes" button and Cancel. */
export function ConfirmBar({
  question,
  yes,
  busy,
  onYes,
  onCancel,
}: {
  question: string
  yes: string
  busy: boolean
  onYes: () => void
  onCancel: () => void
}) {
  return (
    <div className="confirm">
      <span className="grow">{question}</span>
      <button className="btn small danger" onClick={onYes} disabled={busy}>
        {yes}
      </button>
      <button className="btn small ghost" onClick={onCancel} disabled={busy}>
        Cancel
      </button>
    </div>
  )
}
