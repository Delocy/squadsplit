import { MemberName } from '@squadsplit/shared'

export const MEMBER_NAME_MAX = 24
export const MEMBER_NAME_HINT = 'Names are up to 24 characters, with no emoji.'

/** The trimmed name if the API would take it, else null. */
export function parseMemberName(text: string): string | null {
  const parsed = MemberName.safeParse(text)
  return parsed.success ? parsed.data : null
}
