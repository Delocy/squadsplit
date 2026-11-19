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

  it('fits a settle-up row with a "Not joined yet" tag at 320px: names truncate, the end wraps below', () => {
    expect(rule('.row.transfer')).toContain('flex-wrap: wrap')
    expect(rule('.row.transfer .grow')).toMatch(/flex: 1 1 \d+px/)
    expect(rule('.row.transfer .t')).toContain('flex-wrap: nowrap')
    expect(rule('.row.transfer .t .nm')).toMatch(/min-width: 0;.*overflow: hidden;.*text-overflow: ellipsis/)
    expect(rule('.row-end')).toContain('margin-left: auto')
    expect(rule('.row.transfer .t .nm.short')).toContain('flex: none')
    expect(rule('.row.transfer .tags')).toContain('flex-wrap: wrap')
    // A list's one column may shrink below its longest word, so a long name can't push every row past the card.
    expect(rule('ul.list')).toContain('grid-template-columns: minmax(0, 1fr)')
    // Narrow screens stack the amount over its button, so the row keeps one line for as long as it can.
    expect(css).toMatch(/@media \(max-width: 480px\) \{ \.row-end \{ flex-direction: column;/)
  })

  it('keeps the fun bits from breaking money or covering people at 320px', () => {
    const fun = readFileSync(resolve(__dirname, '../src/design/fun.css'), 'utf8')
    const funRule = (selector: string) => fun.split('\n').find((l) => l.startsWith(`${selector} {`)) ?? ''
    // The payback slip's amount never breaks between digits; the stamp moves below it when they don't fit side by side.
    expect(funRule('.slip-amt')).toContain('white-space: nowrap')
    expect(funRule('.slip')).toContain('flex-wrap: wrap')
    // On a phone the duo makes room for the Good Egg sticker in the moment's corner.
    expect(fun).toMatch(/@media \(max-width: 400px\) \{[^}]*\.duo \{[^}]*padding: 0 \d+px/)
    // The ticket's name takes at most two lines, which the slot already holds, so the reveal moves nothing.
    expect(funRule('.tk-r b')).toContain('-webkit-line-clamp: 2')
    expect(funRule('.slot')).toMatch(/min-height: (\d+)px/)
    expect(Number(funRule('.slot').match(/min-height: (\d+)px/)![1])).toBeGreaterThanOrEqual(104)
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

  it('puts a guest’s "Save with an account" on the crumb row on a phone, so it never overlaps the logo', () => {
    expect(rule('.top > .save-account')).toContain('grid-row: 2')
    expect(css).toContain('@media (max-width: 599px) { .top.guest > .crumb { grid-column: 1; } }')
    expect(rule('.top > .err')).toContain('grid-column: 1 / -1')
  })

  it('keeps the Add expense bar off the page: the home pads for it, and every bar clears the safe areas', () => {
    const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8')
    expect(html).toMatch(/<meta name="viewport" content="[^"]*viewport-fit=cover/)
    // The page ends above the bar: its padding is the bar's height plus the home indicator's inset.
    expect(css).toMatch(/\.page\.has-fab \{ padding-bottom: calc\(var\(--fab-bar\) \+ env\(safe-area-inset-bottom\)\); \}/)
    const bar = css.split('\n').find((l) => l.trim().startsWith('.fab-bar { display: flex;')) ?? ''
    expect(bar).toContain('env(safe-area-inset-bottom)')
    // Opaque and full width: nothing scrolls into view under a floating button.
    expect(bar).toMatch(/left: 0; right: 0; bottom: 0;.*background: var\(--bg\)/)
    expect(rule('.wrap')).toMatch(/env\(safe-area-inset-left\).*env\(safe-area-inset-right\)|env\(safe-area-inset-right\).*env\(safe-area-inset-left\)/)
  })
})
