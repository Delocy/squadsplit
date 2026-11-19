// A guest's token: 32 random bytes, base64url (43 characters), handed to the guest's phone once. Only its SHA-256
// is stored, so a copy of the database signs nobody in.

const TOKEN_BYTES = 32

/** The shape of a token: anything else is refused without a lookup. */
export const GUEST_TOKEN = /^[A-Za-z0-9_-]{43}$/

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export const newGuestToken = (): string => base64url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)))

/** The SHA-256 of the token, in hex: what guest_sessions stores. */
export async function hashGuestToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
