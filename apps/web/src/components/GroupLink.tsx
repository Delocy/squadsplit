import type { LinkProps } from 'react-router'
import { usePrefetchGroup } from '../groupData'
import { PageLink } from './PageLink'

/**
 * A PageLink to a group's home. Pointing at it, focusing it or touching it starts loading the group,
 * so the page usually opens with its data already there.
 */
export function GroupLink({ groupId, ...props }: Omit<LinkProps, 'to'> & { groupId: string }) {
  const prefetch = usePrefetchGroup()
  const warm = () => prefetch(groupId)
  return <PageLink {...props} to={`/groups/${groupId}`} onPointerEnter={warm} onFocus={warm} onTouchStart={warm} />
}
