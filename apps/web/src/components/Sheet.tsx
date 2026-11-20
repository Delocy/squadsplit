import { useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode, type RefObject } from 'react'
import { UiIcon, type UiIconName } from '../design/icons'
import { EXIT_MS, useReducedMotion } from '../design/motion'

/** Phones get the bottom sheet; wider screens keep the centred dialog (see dialog.sheet in tokens.css). */
export const SHEET_QUERY = '(max-width: 480px)'
/** How far a sheet is dragged down before letting go closes it. */
const SWIPE_CLOSE_PX = 80

/**
 * Closing a sheet that has its own route: it slides out first (not under reduced motion), then `go` runs.
 * `leaving` is true while it slides.
 */
export function useSheetClose(go: () => void) {
  const reduced = useReducedMotion()
  const [leaving, setLeaving] = useState(false)
  const latest = useRef(go)
  latest.current = go
  useEffect(() => {
    if (!leaving) return
    const timer = setTimeout(() => latest.current(), EXIT_MS)
    return () => clearTimeout(timer)
  }, [leaving])
  return { leaving, close: () => (reduced ? go() : setLeaving(true)) }
}

/**
 * A native modal <dialog>, opened as it mounts: a bottom sheet on a phone (with a grab handle; dragging the header
 * down closes it), a centred dialog on wider screens. Escape, the × and the swipe all ask `onClose`, which may ask
 * first. When it goes, focus goes back to whatever opened it. `actions` sit in the header, before the ×.
 *
 * The browser may close a <dialog> itself: a second Escape or Android Back with no tap in between can't be cancelled
 * (Chrome's close-watcher rules). Unless the sheet is already on its way out, it opens again at once, still asking
 * whatever it was asking ("Discard this expense?"), so the route and the sheet never part ways.
 */
export function Sheet({
  title,
  icon = 'plus',
  leaving,
  onClose,
  actions,
  className,
  children,
}: {
  title: string
  icon?: UiIconName
  /** Sliding out (see useSheetClose). */
  leaving: boolean
  onClose: () => void
  actions?: ReactNode
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const swipe = useSwipeDown(ref, onClose)
  const leavingNow = useRef(leaving)
  leavingNow.current = leaving
  useKeyboardInset()
  useLayoutEffect(() => {
    const opener = document.activeElement
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])
  const openModal = () => {
    const d = ref.current
    if (!d || d.open) return
    // jsdom has no showModal; the open attribute is the same dialog, just not modal.
    if (typeof d.showModal === 'function') d.showModal()
    else d.setAttribute('open', '')
  }
  useLayoutEffect(openModal, [])
  return (
    <dialog
      ref={ref}
      className={['sheet', className, leaving && 'out'].filter(Boolean).join(' ')}
      tabIndex={-1}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClose={() => {
        if (leavingNow.current) return
        openModal()
        onClose()
      }}
    >
      <div className="dlg-h" {...swipe}>
        <span className="dlg-grab" aria-hidden="true" />
        <UiIcon name={icon} />
        <h3 id={titleId}>{title}</h3>
        {actions}
        <button type="button" className="x" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="dlg-b">{children}</div>
    </dialog>
  )
}

/**
 * How much of the layout viewport the on-screen keyboard covers, as `--kb` on the page, so a bottom sheet (and its
 * sticky footer) sits above it. The visual viewport shrinks for the keyboard (iOS, and Android by default) while the
 * layout viewport doesn't; where the layout viewport shrinks itself, this stays 0.
 */
function useKeyboardInset() {
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const root = document.documentElement
    const update = () => {
      const covered = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop))
      root.style.setProperty('--kb', `${covered}px`)
    }
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
      root.style.removeProperty('--kb')
    }
  }, [])
}

/**
 * Dragging a phone's sheet down by its header: it follows the finger, and closes (via `onClose`) once let go past
 * SWIPE_CLOSE_PX; otherwise it springs back. Mouse drags and wider screens are left alone.
 */
function useSwipeDown(dialog: RefObject<HTMLDialogElement | null>, onClose: () => void) {
  const start = useRef<{ y: number; id: number } | null>(null)
  const dy = useRef(0)
  const move = (y: number) => {
    const d = dialog.current
    if (!d || !start.current) return
    dy.current = Math.max(0, y - start.current.y)
    d.style.transition = 'none'
    d.style.transform = dy.current ? `translateY(${dy.current}px)` : ''
  }
  const end = () => {
    const d = dialog.current
    if (!start.current || !d) return
    start.current = null
    d.style.transition = ''
    const springBack = () => {
      if (!d.classList.contains('out')) d.style.transform = ''
    }
    // Past the line it asks to close: the slide-out starts from where the finger left it. If it stays open (say, it
    // asks about unsaved changes first), it springs back.
    if (dy.current > SWIPE_CLOSE_PX) {
      onClose()
      setTimeout(springBack, 50)
    } else springBack()
    dy.current = 0
  }
  return {
    onPointerDown: (e: PointerEvent) => {
      if (e.pointerType === 'mouse' || !window.matchMedia?.(SHEET_QUERY).matches) return
      if ((e.target as HTMLElement).closest('button, a, input')) return
      start.current = { y: e.clientY, id: e.pointerId }
      e.currentTarget.setPointerCapture?.(e.pointerId)
    },
    onPointerMove: (e: PointerEvent) => {
      if (start.current?.id === e.pointerId) move(e.clientY)
    },
    onPointerUp: end,
    onPointerCancel: end,
  }
}
