import { MAX_GROUP_MEMBERS } from '@squadsplit/shared'
import { HttpError } from './errors'

// The 409s of joining a group, claiming a name and saving a guest to an account.

export const groupFull = () => new HttpError(409, 'group_full', `This group is full (${MAX_GROUP_MEMBERS} people).`)
export const alreadyClaimed = () => new HttpError(409, 'already_claimed', 'Someone has already claimed that name.')
export const alreadyInGroup = () =>
  new HttpError(409, 'already_in_group', "You've been in this group before, so join as yourself.")
