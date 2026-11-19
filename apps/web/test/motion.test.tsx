import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, render, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useReducedMotion } from '../src/design/motion'
import { Skeleton } from '../src/design/Skeleton'
import { mockReducedMotion } from './motion-mock'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const css = readFileSync(resolve(__dirname, '../src/design/tokens.css'), 'utf8')

describe('useReducedMotion', () => {
  it('follows the prefers-reduced-motion media query, live', () => {
    const motion = mockReducedMotion(false)
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(false)
    act(() => motion.set(true))
    expect(result.current).toBe(true)
  })

  it('is false where matchMedia does not exist', () => {
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(false)
  })
})

describe('Skeleton', () => {
  it('is a fixed-size placeholder that screen readers skip', () => {
    const { container } = render(<Skeleton w={48} h={48} r={14} />)
    const block = container.firstElementChild as HTMLElement
    expect(block.classList.contains('sk')).toBe(true)
    expect(block.getAttribute('aria-hidden')).toBe('true')
    expect(block.style.width).toBe('48px')
    expect(block.style.height).toBe('48px')
    expect(block.style.borderRadius).toBe('14px')
  })

  it('can be a circle', () => {
    const { container } = render(<Skeleton w={34} h={34} circle />)
    expect((container.firstElementChild as HTMLElement).style.borderRadius).toBe('50%')
  })
})

describe('motion CSS', () => {
  it('shimmers skeletons', () => {
    expect(css).toMatch(/\.sk::after \{[^}]*animation: shimmer /)
    expect(css).toContain('@keyframes shimmer')
  })

  it('cross-fades and slides pages briefly, and keeps the top bar out of the fade', () => {
    expect(css).toMatch(/::view-transition-old\(root\) \{[^}]*animation: 1[6-9]0ms ease-out/)
    expect(css).toMatch(/::view-transition-new\(root\) \{[^}]*animation: 2[0-2]0ms ease-out/)
    expect(css).toMatch(/\.top \{[^}]*view-transition-name: top-bar/)
    expect(css).toMatch(/::view-transition-group\(top-bar\)[^{]*\{[^}]*animation: none/)
  })

  it('turns every animation off under reduced motion, pseudo-elements and view transitions included', () => {
    const reduced = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).toContain('*, *::before, *::after, ::backdrop')
    expect(reduced).toContain('::view-transition-group(*)')
    expect(reduced).toContain('::view-transition-old(*)')
    expect(reduced).toContain('::view-transition-new(*)')
    expect(reduced).toContain('animation: none !important')
  })
})
