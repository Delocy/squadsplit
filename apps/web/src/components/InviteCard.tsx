import type { GroupDTO } from '@squadsplit/shared'
import { useEffect, useRef, useState } from 'react'
import { useApi } from '../api'
import { UiIcon } from '../design/icons'
import { useGroupMutation } from '../groupData'
import { ConfirmBar, useConfirmStep } from './ConfirmBar'
import { ErrorNote } from './ErrorNote'
import { InviteQr } from './InviteQr'
import { MoreMenu } from './MoreMenu'
import { useToast } from './Toast'

export const COPIED = 'Link copied. Paste it in your chat'
const RESET_QUESTION =
  'Make a new link? The current link and code stop working. Friends with accounts stay in. Guests on their phones are signed out and need the new link.'

/** "K5KEDQ3M" → "K5KE DQ3M": two halves, easy to read aloud. */
export const spacedCode = (code: string) => `${code.slice(0, 4)} ${code.slice(4)}`

const canShare = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function'

/**
 * The owner's reset of the invite link, shared by the card's "⋯" menu (which asks) and its body (which shows the
 * question, and "New link ready" after). Only the owner gets it.
 */
function useInviteReset(group: GroupDTO, me: string) {
  const api = useApi()
  const confirm = useConfirmStep()
  const reset = useGroupMutation(group.id, () => api.post<{ inviteCode: string }>(`/groups/${group.id}/invite/reset`))
  const [fresh, setFresh] = useState(false)
  const moreRef = useRef<HTMLButtonElement>(null)
  return { owner: group.ownerId === me, confirm, reset, fresh, setFresh, moreRef }
}
type InviteReset = ReturnType<typeof useInviteReset>

/** The owner's "⋯" menu in the header: Reset link. */
function InviteMenu({ invite }: { invite: InviteReset }) {
  if (!invite.owner) return null
  return (
    <MoreMenu
      label="Invite link options"
      buttonRef={invite.moreRef}
      items={[
        {
          label: 'Reset link',
          onSelect: () => {
            invite.reset.reset()
            invite.setFresh(false)
            invite.confirm.open()
          },
        },
      ]}
    />
  )
}

/**
 * Inviting friends, for everyone in the group: Share (the phone's share sheet) leads, Copy follows (it leads where
 * there's no share sheet), then the link and its code as text, and the QR code folded away for friends next to you.
 * The owner can reset the link from the header's "⋯" menu.
 */
function InviteBody({ group, invite }: { group: GroupDTO; invite: InviteReset }) {
  const code = group.inviteCode
  const link = `${location.origin}/join/${code}`
  const share = canShare()
  const toast = useToast()
  const [copyFailed, setCopyFailed] = useState(false)
  const linkRef = useRef<HTMLParagraphElement>(null)
  const mainRef = useRef<HTMLButtonElement>(null)
  const { confirm, reset } = invite
  // After the bar goes: back to the "⋯" button on Cancel, or to Share with the new link after a reset.
  const focusAfterBar = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (confirm.showBar || !focusAfterBar.current) return
    focusAfterBar.current.focus()
    focusAfterBar.current = null
  }, [confirm.showBar])

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link)
      setCopyFailed(false)
      toast.show(COPIED)
    } catch {
      // In-app browsers (Telegram, WhatsApp) can refuse the clipboard: select the link for a long-press copy.
      setCopyFailed(true)
      const selection = window.getSelection()
      if (linkRef.current && selection) {
        const range = document.createRange()
        range.selectNodeContents(linkRef.current)
        selection.removeAllRanges()
        selection.addRange(range)
      }
    }
  }

  async function shareLink() {
    try {
      await navigator.share({ title: `Join ${group.name} on SquadSplit`, text: 'Split with us on SquadSplit:', url: link })
    } catch (error) {
      // Closing the share sheet is not a failure; anything else falls back to copying.
      if (!(error instanceof DOMException && error.name === 'AbortError')) await copyLink()
    }
  }

  return (
    <div className="invite">
      <p className="s">Send this to your group chat. Anyone with it can join, with or without an account.</p>
      {invite.fresh && (
        <p className="invite-fresh" role="status">
          New link ready
        </p>
      )}
      {share && (
        <button ref={mainRef} type="button" className="btn primary invite-share" onClick={shareLink}>
          <UiIcon name="share" />
          Share invite link
        </button>
      )}
      <div className="invite-link">
        <p className="invite-url" ref={linkRef}>
          {/* Breaks before "join/" when it must, keeping the code whole. */}
          {location.origin}/<wbr />join/<b>{code}</b>
        </p>
        <button ref={share ? undefined : mainRef} type="button" className={share ? 'btn' : 'btn primary'} onClick={copyLink}>
          <UiIcon name="copy" />
          Copy
        </button>
      </div>
      {copyFailed && <p className="err">Couldn't copy it. The link is selected: copy it from there.</p>}
      <p className="invite-code">
        Code: <b>{spacedCode(code)}</b>
      </p>
      <details className="invite-qr">
        <summary>
          <UiIcon name="qr" />
          <span>
            Show QR code <span className="s">(for friends next to you)</span>
          </span>
        </summary>
        <div className="qr-box">
          <InviteQr text={link} />
        </div>
        <p className="s">Turn your screen brightness up so it scans.</p>
      </details>
      {confirm.showBar && (
        <ConfirmBar
          question={RESET_QUESTION}
          yes="Make new link"
          busyLabel="Making…"
          busy={reset.isPending}
          leaving={confirm.leaving}
          onYes={() =>
            reset.mutate(undefined, {
              onSuccess: () => {
                invite.setFresh(true)
                focusAfterBar.current = mainRef.current
                confirm.close()
              },
            })
          }
          onCancel={() => {
            focusAfterBar.current = invite.moreRef.current
            confirm.close()
          }}
        />
      )}
      {reset.isError && <ErrorNote error={reset.error} />}
      {toast.region}
    </div>
  )
}

/** The invite card, on Group settings and on a group with no expenses yet. */
export function InviteCard({ group, me }: { group: GroupDTO; me: string }) {
  const invite = useInviteReset(group, me)
  return (
    <section className="card invite-card" aria-labelledby="invite-h">
      <h3 id="invite-h">
        <UiIcon name="heart" />
        Invite friends
        <span className="right">
          <InviteMenu invite={invite} />
        </span>
      </h3>
      <InviteBody group={group} invite={invite} />
    </section>
  )
}

/** The same card's insides and "⋯" menu, for the invite sheet (see InviteSheet). */
export function useInviteParts(group: GroupDTO, me: string) {
  const invite = useInviteReset(group, me)
  return { menu: <InviteMenu invite={invite} />, body: <InviteBody group={group} invite={invite} /> }
}
