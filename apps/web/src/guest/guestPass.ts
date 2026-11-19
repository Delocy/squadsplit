import { useMemo, useSyncExternalStore } from 'react'

// A guest's pass for one group, kept on this phone: the token the API handed out when they joined (only ever sent
// in the X-Guest-Token header, never in a URL), who they are in the group, and the group's name and invite code
// for when they are signed out. One per group, in localStorage under `squadsplit.guest.<groupId>`. Storage can be
// missing or blocked (private mode), so every access is guarded: then the phone simply remembers nothing.

export interface GuestPass {
  token: string
  userId: string
  groupName: string
  /** The invite code they joined with, so a signed-out guest can be sent back to it. */
  code: string
}

const KEY_PREFIX = 'squadsplit.guest.'
const keyOf = (groupId: string) => `${KEY_PREFIX}${groupId}`

const listeners = new Set<() => void>()
const changed = () => listeners.forEach((listener) => listener())

function parsePass(raw: string | null): GuestPass | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<GuestPass> | null
    const ok = v && [v.token, v.userId, v.groupName, v.code].every((f) => typeof f === 'string' && f !== '')
    return ok ? (v as GuestPass) : null
  } catch {
    return null
  }
}

function rawPass(groupId: string): string | null {
  try {
    return localStorage.getItem(keyOf(groupId))
  } catch {
    return null
  }
}

export const readGuestPass = (groupId: string): GuestPass | null => parsePass(rawPass(groupId))

export function saveGuestPass(groupId: string, pass: GuestPass): void {
  try {
    localStorage.setItem(keyOf(groupId), JSON.stringify(pass))
  } catch {
    // Not remembered: the guest is in for this visit only.
  }
  try {
    sessionStorage.removeItem(noticeKeyOf(groupId))
  } catch {
    // Nothing was stored.
  }
  changed()
}

export function dropGuestPass(groupId: string): void {
  try {
    localStorage.removeItem(keyOf(groupId))
  } catch {
    // Nothing was stored.
  }
  changed()
}

/** The groups this phone holds a pass for (some may no longer work: see OnThisPhone). */
export function guestPassGroupIds(): string[] {
  try {
    const ids: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(KEY_PREFIX)) ids.push(key.slice(KEY_PREFIX.length))
    }
    return ids
  } catch {
    return []
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  // Another tab joining or being signed out.
  window.addEventListener('storage', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}

/** This phone's pass for the group, kept up to date. */
export function useGuestPass(groupId: string): GuestPass | null {
  const raw = useSyncExternalStore(subscribe, () => rawPass(groupId))
  return useMemo(() => parsePass(raw), [raw])
}

// Groups whose guest was signed out in this tab (the owner reset the link or freed up the name), and what to tell
// them, in sessionStorage under `squadsplit.guest-signed-out.<groupId>`: it survives a reload, not the tab.

export interface SignedOutNotice {
  groupName: string
  code: string
}

const noticeKeyOf = (groupId: string) => `squadsplit.guest-signed-out.${groupId}`

function rawNotice(groupId: string): string | null {
  try {
    return sessionStorage.getItem(noticeKeyOf(groupId))
  } catch {
    return null
  }
}

/** A request with the group's pass came back 401: the pass is dead. Forget it, and say so on the group's pages. */
export function guestSignedOut(groupId: string): void {
  const pass = readGuestPass(groupId)
  if (pass) {
    try {
      sessionStorage.setItem(noticeKeyOf(groupId), JSON.stringify({ groupName: pass.groupName, code: pass.code }))
    } catch {
      // The group's pages just ask them to sign in.
    }
  }
  dropGuestPass(groupId)
}

/** Set once the group's guest has been signed out in this tab: what to tell them. */
export function useSignedOutNotice(groupId: string): SignedOutNotice | null {
  const raw = useSyncExternalStore(subscribe, () => rawNotice(groupId))
  return useMemo(() => {
    try {
      const v = raw ? (JSON.parse(raw) as Partial<SignedOutNotice>) : null
      return v && typeof v.groupName === 'string' && typeof v.code === 'string' ? (v as SignedOutNotice) : null
    } catch {
      return null
    }
  }, [raw])
}
