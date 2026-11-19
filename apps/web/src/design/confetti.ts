import { confettiPiece } from './art'
import { prefersReducedMotion } from './motion'

/** A burst of SVG hearts and stars from the middle of `from`, as in the playground. Skipped under reduced motion. */
export function confetti(from: Element | null) {
  if (!from || prefersReducedMotion()) return
  const r = from.getBoundingClientRect()
  for (let i = 0; i < 20; i++) {
    const s = document.createElement('span')
    s.className = 'confetti'
    s.setAttribute('aria-hidden', 'true')
    s.innerHTML = confettiPiece(i)
    s.style.left = `${r.left + r.width / 2}px`
    s.style.top = `${r.top + r.height / 2}px`
    const angle = Math.random() * Math.PI * 2
    const distance = 60 + Math.random() * 110
    s.style.setProperty('--dx', `${Math.cos(angle) * distance}px`)
    s.style.setProperty('--dy', `${Math.sin(angle) * distance - 40}px`)
    s.style.setProperty('--rot', `${(Math.random() - 0.5) * 360}deg`)
    document.body.appendChild(s)
    setTimeout(() => s.remove(), 1300)
  }
}
