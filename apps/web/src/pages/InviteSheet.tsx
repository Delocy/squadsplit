import type { GroupDTO } from '@squadsplit/shared'
import { useLocation, useNavigate, useParams } from 'react-router'
import { useInviteParts } from '../components/InviteCard'
import { Sheet, useSheetClose } from '../components/Sheet'
import { SkText } from '../design/Skeleton'
import { useGroup } from '../groupData'
import { useMyId } from '../guest/GroupAccess'

/** `/groups/:id/invite`: the invite card in a sheet over the group home, from its Invite button. */
export function InviteSheet() {
  const groupId = useParams().id ?? ''
  const me = useMyId()
  const group = useGroup(groupId)
  const navigate = useNavigate()
  // Opened from the group home, closing steps back to it, so Back doesn't open the sheet again.
  const fromHome = (useLocation().state as { fromHome?: boolean } | null)?.fromHome === true
  const sheet = useSheetClose(() =>
    fromHome ? navigate(-1) : navigate(`/groups/${groupId}`, { replace: true, preventScrollReset: true }),
  )
  if (!group.data) {
    return (
      <Sheet title="Invite friends" icon="heart" leaving={sheet.leaving} onClose={sheet.close}>
        <p aria-busy="true">
          <SkText w={240} />
        </p>
      </Sheet>
    )
  }
  return <InviteSheetFor group={group.data} me={me} leaving={sheet.leaving} onClose={sheet.close} />
}

function InviteSheetFor({ group, me, leaving, onClose }: { group: GroupDTO; me: string; leaving: boolean; onClose: () => void }) {
  const parts = useInviteParts(group, me)
  return (
    <Sheet title="Invite friends" icon="heart" leaving={leaving} onClose={onClose} actions={parts.menu} className="invite-sheet">
      {parts.body}
    </Sheet>
  )
}
