import type { CSSProperties } from 'react'

type Size = number | string

/**
 * A placeholder block in the shape of content that is still loading, sized like the real thing so nothing moves
 * when it arrives. It shimmers (not under reduced motion) and is hidden from screen readers: the loading region
 * around it says what is loading. Without `w` it is as wide as its box; CSS on `className` can size it instead.
 */
export function Skeleton({
  w,
  h,
  r,
  circle = false,
  className,
  style,
}: {
  w?: Size
  h?: Size
  /** Corner radius; ignored for a circle. */
  r?: Size
  circle?: boolean
  className?: string
  style?: CSSProperties
}) {
  return (
    <span
      className={className ? `sk ${className}` : 'sk'}
      aria-hidden="true"
      style={{ width: w, height: h, borderRadius: circle ? '50%' : r, ...style }}
    />
  )
}

/**
 * A line of text that hasn't loaded. Its bar and margins add up to one line of the surrounding text (see .sk.text),
 * so put it where the real text goes, inside the element that styles that text.
 */
export const SkText = ({ w }: { w?: Size }) => <Skeleton w={w} className="text" />

/** A small spinning ring for a button that is waiting on the server. Still under reduced motion. */
export const Spinner = () => <span className="spinner" aria-hidden="true" />
