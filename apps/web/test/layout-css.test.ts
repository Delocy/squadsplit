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
    expect(rule('.scan-banner')).toContain('overflow-wrap: anywhere')
  })

  it('animates the receipt reader with the existing bob motion, which reduced motion turns off', () => {
    expect(rule('.scan-spin')).toMatch(/animation: bob /)
    expect(css).toContain('@keyframes bob')
    expect(css).toContain('@media (prefers-reduced-motion: reduce) { * { animation: none !important;')
  })
})
