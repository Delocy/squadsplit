import type { QuickDraft } from './draft'

/**
 * A quick split being made, kept in this tab's sessionStorage under its own id, so coming back to it (Back, Forward,
 * a reload, the phone dropping the tab in the background) finds it as it was. `start` is what it began from, to tell
 * whether anything changed; `savedId` is set once it has been saved, so saving again updates that split.
 */
export interface StoredQuickDraft {
  start: QuickDraft
  draft: QuickDraft
  savedId?: string
}

const key = (draftId: string) => `squadsplit.quickDraft.${draftId}`

/** A new draft's id. */
export const newDraftId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`

/** The stored draft, or null when there is none, it can't be read, or the browser refuses storage. */
export function loadQuickDraft(draftId: string): StoredQuickDraft | null {
  try {
    const raw = sessionStorage.getItem(key(draftId))
    const stored = raw ? (JSON.parse(raw) as StoredQuickDraft) : null
    return stored && Array.isArray(stored.draft?.dishes) && Array.isArray(stored.start?.dishes) ? stored : null
  } catch {
    return null
  }
}

/** Keeps the draft for this tab. With storage refused (private mode, full), it just isn't kept. */
export function saveQuickDraft(draftId: string, stored: StoredQuickDraft): void {
  try {
    sessionStorage.setItem(key(draftId), JSON.stringify(stored))
  } catch {
    // Nothing to do: the bill stays on screen, it just won't survive leaving.
  }
}
