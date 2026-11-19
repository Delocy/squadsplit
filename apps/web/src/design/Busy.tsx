import type { ReactNode } from 'react'

/** A small spinning ring for a button that is waiting on the server. Still under reduced motion. */
export const Spinner = () => <span className="spinner" aria-hidden="true" />

/** A button's label: `children`, or a spinner and `label` ("Saving…") while its action waits on the server. */
export function BusyLabel({ busy, label, children }: { busy: boolean; label: string; children: ReactNode }) {
  return busy ? (
    <>
      <Spinner />
      {label}
    </>
  ) : (
    <>{children}</>
  )
}
