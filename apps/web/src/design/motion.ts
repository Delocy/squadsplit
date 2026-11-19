/** Whether the user asked for less motion. All animation is off then (see the end of tokens.css). */
export const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
