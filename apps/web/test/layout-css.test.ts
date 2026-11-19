import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(__dirname, '../src/design/tokens.css'), 'utf8')
const rule = (selector: string) => css.split('\n').find((l) => l.startsWith(`${selector} {`)) ?? ''

// jsdom does no layout, so these pin the narrow-screen rules that keep money and names readable at 375px.
describe('narrow-screen layout rules', () => {
  it('lets the balance headline shrink and wrap instead of overflowing', () => {
    expect(rule('.balance .amt')).toMatch(/clamp\(26px, 8vw, 38px\)/)
    expect(rule('.balance .amt')).toContain('overflow-wrap: anywhere')
    expect(css).toContain('.balance > div:not(.buddy) { min-width: 0; }')
  })

  it('never ellipsizes money in the stats row', () => {
    expect(rule('.stat .v')).not.toContain('ellipsis')
    expect(rule('.stat .v')).not.toContain('nowrap')
    expect(rule('.stats')).toContain('auto-fit')
  })

  it('uses a flexible animal grid and lets the rename button wrap below the input', () => {
    expect(rule('.picker-animals')).toContain('auto-fill')
    expect(rule('.invite-link')).toContain('flex-wrap: wrap')
  })

  it('does not ellipsize the nickname preview', () => {
    expect(rule('.you-preview b')).not.toContain('ellipsis')
  })

  it('fits the expense dialog at 375px: the split tabs wrap, and the dialog body never scrolls sideways', () => {
    expect(rule('.split-h')).toContain('flex-wrap: wrap')
    expect(rule('.tabs')).toContain('flex-wrap: wrap')
    expect(rule('.tabs')).toContain('max-width: 100%')
    expect(rule('.dlg-b')).toContain('min-width: 0')
    expect(rule('.dlg-b')).toContain('overflow-x: hidden')
    expect(rule('.scan-actions')).toContain('flex-wrap: wrap')
    // The receipt card's text column can shrink at 375px instead of pushing the dialog wider.
    expect(rule('.scan-card')).toContain('grid-template-columns: auto minmax(0, 1fr)')
    expect(rule('.scan-lede')).toContain('overflow-wrap: anywhere')
    expect(rule('.scan-banner')).toContain('overflow-wrap: anywhere')
  })

  it('spins the receipt reader on the Scan button, which reduced motion turns off', () => {
    expect(rule('.spinner')).toMatch(/animation: spin /)
    expect(css).toContain('@keyframes spin')
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\*, \*::before, \*::after, ::backdrop \{ animation: none !important;/)
  })

  it('keeps your avatar and Sign out on the top bar’s first row, right-aligned, at every width', () => {
    expect(rule('.top')).toContain('display: grid')
    expect(rule('.top')).toContain('grid-template-columns: minmax(0, 1fr) auto')
    expect(rule('.top > .logo')).toContain('grid-column: 1')
    expect(rule('.top > .me')).toMatch(/grid-row: 1; grid-column: -2;.*justify-self: end;.*flex-shrink: 0/)
    // The group breadcrumb gets its own full-width row below the name, and joins the first row from 600px up.
    expect(rule('.top > .crumb')).toContain('grid-column: 1 / -1')
    expect(css).toContain(
      '@media (min-width: 600px) { .top { grid-template-columns: auto minmax(0, 1fr) auto; } .top > .crumb { grid-column: 2; grid-row: 1; } }',
    )
  })
})
