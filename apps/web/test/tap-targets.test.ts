import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// jsdom does no layout, so this pins the shared rules that give every control a 44×44px tap. The harness's
// Playwright check (see the UX batch report) measures the real pages at 375px and 320px.
const css = ['../src/design/tokens.css', '../src/quick/quick.css'].map((f) => readFileSync(resolve(__dirname, f), 'utf8')).join('\n')

/** The selectors whose rule (a line starting with them) sets `min-height` of at least 44px. */
const minHeight = (selector: string) => {
  const line = css.split('\n').find((l) => l.trim().startsWith(`${selector} {`)) ?? ''
  return Number(/min-height: (\d+)px/.exec(line)?.[1] ?? 0)
}

/** The selectors given an invisible 44×44 hit area, centred on a control drawn smaller (one shared rule). */
const hitArea = (() => {
  const rule = /([^{}]+)\{ content: ""; position: absolute; left: 50%; top: 50%; width: max\(100%, 44px\); height: max\(100%, 44px\);/.exec(css)
  return new Set((rule?.[1] ?? '').split(',').map((s) => s.trim().replace(/::after$/, '')))
})()

const tappable = (selector: string) => minHeight(selector) >= 44 || hitArea.has(selector)

describe('tap targets', () => {
  it('draws buttons, inputs and selects at least 44px tall', () => {
    expect(minHeight('.btn')).toBeGreaterThanOrEqual(44)
    expect(css).toMatch(/input\[type=text\], input\[type=number\], input\[type=date\], select \{[^}]*min-height: 44px/)
  })

  it.each([
    '.btn.small',
    '.tabs button',
    '.chip',
    '.chip-x',
    '.x',
    '.swatch',
    '.me-button',
    '.me-pop-link',
    '.qs-tap',
    '.qs-steps button',
    '.qs-chip.ghost',
    '.qs-tick',
    '.pub-undo',
  ])('gives %s a 44×44 tap', (selector) => {
    expect(tappable(selector)).toBe(true)
  })

  it('makes a whole charge row the tap for its switch', () => {
    // The switch is drawn 26px tall inside a <label> row, so tapping anywhere on the row flips it.
    expect(css).toMatch(/\.qs-setting \{ display: flex;[^}]*padding: 10px 0;/)
  })

  it('keeps a hit area from reaching into its neighbour: chips are spaced at least 8px apart', () => {
    expect(css).toMatch(/\.chips \{ display: flex; flex-wrap: wrap; gap: 8px; \}/)
  })

  it("keeps a row's × hit area off the price field next to it: the column gap is wider than the overhang", () => {
    // A × drawn 26–28px wide overhangs its 44px hit area by up to 9px each side.
    expect(css).toMatch(/\.item-h \{[^}]*gap: 6px 10px;/)
    expect(css).toMatch(/\.qs-dish-row \{[^}]*gap: 6px 10px;/)
  })
})
