import { QUICK_SPLIT_LINK_DAYS, type ShareLinkState } from '@squadsplit/shared'
import type { SplitRow } from './store'

/** A share token: 16 random bytes (128 bits) as 22 characters of base64url, so it can't be guessed. */
export function newShareToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** What a share token looks like; anything else is answered 404 without a lookup. */
export const SHARE_TOKEN = /^[A-Za-z0-9_-]{22}$/

/** When a link made at `createdMs` stops working. */
export const shareExpiry = (createdMs: number) => new Date(createdMs + QUICK_SPLIT_LINK_DAYS * 86_400_000).toISOString()

/** 'on' until the owner stops sharing or the link expires. */
export function linkState(split: Pick<SplitRow, 'shareToken' | 'shareExpiresAt' | 'shareRevokedAt'>, now = new Date()): ShareLinkState {
  const live = split.shareToken !== null && split.shareRevokedAt === null && split.shareExpiresAt !== null && Date.parse(split.shareExpiresAt) > now.getTime()
  return live ? 'on' : 'off'
}
