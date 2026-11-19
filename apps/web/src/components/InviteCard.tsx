import { useEffect, useState } from 'react'
import { useApi } from '../api'
import { UiIcon } from '../design/icons'
import { useGroupMutation } from '../groupData'
import { ConfirmBar, useConfirmStep } from './ConfirmBar'
import { ErrorNote } from './ErrorNote'
import { InviteQr } from './InviteQr'

/** The owner's invite link: copy it, scan it, or reset it so the old one stops working. */
export function InviteCard({ groupId, inviteCode }: { groupId: string; inviteCode: string }) {
  const api = useApi()
  const link = `${location.origin}/join/${inviteCode}`
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle')
  const confirm = useConfirmStep()
  const reset = useGroupMutation(groupId, () => api.post<{ inviteCode: string }>(`/groups/${groupId}/invite/reset`))

  useEffect(() => {
    if (copy !== 'copied') return
    const timer = setTimeout(() => setCopy('idle'), 2000)
    return () => clearTimeout(timer)
  }, [copy])

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link)
      setCopy('copied')
    } catch {
      setCopy('failed')
    }
  }

  return (
    <section className="card" aria-labelledby="invite-h">
      <h3 id="invite-h">
        <UiIcon name="heart" />
        Invite friends
      </h3>
      <div className="invite">
        <div className="qr-box">
          <InviteQr text={link} />
        </div>
        <div className="invite-side">
          <p className="s">Send this link, or let friends scan the code. Anyone with it can join.</p>
          <div className="invite-link">
            <input type="text" readOnly value={link} aria-label="Invite link" onFocus={(e) => e.target.select()} />
            <button className="btn" onClick={copyLink}>
              {copy === 'copied' ? 'Copied' : 'Copy'}
            </button>
          </div>
          {copy === 'failed' && <p className="err">Couldn't copy it. Select the link and copy it yourself.</p>}
          {confirm.showBar ? (
            <ConfirmBar
              question="The old link will stop working."
              yes="Yes, reset it"
              busyLabel="Resetting…"
              busy={reset.isPending}
              leaving={confirm.leaving}
              onYes={() => reset.mutate(undefined, { onSuccess: confirm.close })}
              onCancel={confirm.close}
            />
          ) : (
            <button ref={confirm.triggerRef} className="btn small ghost" onClick={confirm.open}>
              Reset invite link
            </button>
          )}
          {reset.isError && <ErrorNote error={reset.error} />}
        </div>
      </div>
    </section>
  )
}
