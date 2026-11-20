import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Sheet } from '../src/components/Sheet'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** A visual viewport the test moves, like the keyboard does on a phone. */
function fakeViewport(height: number) {
  const viewport = Object.assign(new EventTarget(), { height, offsetTop: 0 })
  vi.stubGlobal('visualViewport', viewport)
  vi.stubGlobal('innerHeight', 800)
  return viewport
}
const kb = () => document.documentElement.style.getPropertyValue('--kb')

describe('a sheet over the on-screen keyboard', () => {
  it('sets --kb to how much of the page the keyboard covers, follows it, and clears it when the sheet goes', () => {
    const viewport = fakeViewport(800)
    const { unmount } = render(
      <Sheet title="New expense" leaving={false} onClose={() => {}}>
        <input aria-label="Amount" />
      </Sheet>,
    )
    expect(kb()).toBe('0px')

    // The keyboard comes up: the visual viewport shrinks to 460px of the 800px page.
    viewport.height = 460
    act(() => void viewport.dispatchEvent(new Event('resize')))
    expect(kb()).toBe('340px')

    // iOS scrolls the visual viewport down to the field: the part under the keyboard is what's left below it.
    viewport.offsetTop = 120
    act(() => void viewport.dispatchEvent(new Event('scroll')))
    expect(kb()).toBe('220px')

    // Keyboard down.
    viewport.height = 800
    viewport.offsetTop = 0
    act(() => void viewport.dispatchEvent(new Event('resize')))
    expect(kb()).toBe('0px')

    unmount()
    expect(kb()).toBe('')
    viewport.height = 300
    viewport.dispatchEvent(new Event('resize'))
    expect(kb()).toBe('')
  })

  it('does nothing where there is no visual viewport', () => {
    vi.stubGlobal('visualViewport', undefined)
    render(
      <Sheet title="New expense" leaving={false} onClose={() => {}}>
        x
      </Sheet>,
    )
    expect(kb()).toBe('')
  })
})
