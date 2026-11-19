import { useEffect, useState } from 'react'

/** How long a toast stays up. */
export const TOAST_MS = 2600

/**
 * A short message that rises at the bottom of the screen and goes after a moment. The live region is always there,
 * so screen readers hear each message.
 */
export function useToast() {
  const [toast, setToast] = useState<{ text: string; n: number } | null>(null)
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), TOAST_MS)
    return () => clearTimeout(timer)
  }, [toast])
  return {
    show: (text: string) => setToast((t) => ({ text, n: (t?.n ?? 0) + 1 })),
    region: (
      <div className="toast-region" role="status" aria-live="polite">
        {toast && (
          <span key={toast.n} className="toast">
            {toast.text}
          </span>
        )}
      </div>
    ),
  }
}
