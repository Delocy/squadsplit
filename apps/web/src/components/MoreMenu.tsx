import { useEffect, useId, useRef, useState, type KeyboardEvent, type Ref } from 'react'
import { UiIcon } from '../design/icons'

export interface MoreMenuItem {
  label: string
  onSelect: () => void
}

/**
 * A "⋯" button that opens a small menu of rarer actions. It closes on Escape (focus goes back to the button), a tap
 * away, or picking an item. `buttonRef` reaches the "⋯" button, to give it focus back later.
 */
export function MoreMenu({ label, items, buttonRef }: { label: string; items: MoreMenuItem[]; buttonRef?: Ref<HTMLButtonElement> }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const listId = useId()
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !open) return
    // Inside a dialog, Escape closes the menu, not the dialog.
    e.preventDefault()
    e.stopPropagation()
    setOpen(false)
    box.current?.querySelector<HTMLButtonElement>('.more-button')?.focus()
  }

  return (
    <div className="more-menu" ref={box} onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        className="more-button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
      >
        <UiIcon name="more" />
      </button>
      {open && (
        <div className="more-pop card" id={listId}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              className="me-pop-link"
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
