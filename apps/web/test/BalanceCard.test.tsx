import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BalanceCard } from '../src/components/BalanceCard'

afterEach(cleanup)

const card = (cents: number) => {
  render(<BalanceCard cents={cents} currency="SGD" avatar={{ animal: 'fox', color: 'peach' }} seed={0} />)
  return screen.getByRole('region', { name: 'Your balance' })
}

describe('BalanceCard', () => {
  it('says what the group owes you when you are owed', () => {
    const el = card(500)
    expect(el.querySelector('.lbl')!.textContent).toBe("You're owed")
    expect(el.querySelector('.amt')!.textContent).toBe('$5.00')
    expect(el.classList.contains('owed')).toBe(true)
  })

  it('says what you owe, and the mascot shivers', () => {
    const el = card(-500)
    expect(el.querySelector('.lbl')!.textContent).toBe('You owe')
    expect(el.querySelector('.amt')!.textContent).toBe('$5.00')
    expect(el.classList.contains('owe')).toBe(true)
  })

  it('says all square at zero, with no emoji', () => {
    const el = card(0)
    expect(el.querySelector('.amt')!.textContent).toBe('All square')
    expect(el.classList.contains('even')).toBe(true)
    expect(document.body.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
  })

  it('formats in the group currency', () => {
    render(<BalanceCard cents={1234} currency="USD" avatar={{ animal: 'fox', color: 'peach' }} seed={0} />)
    expect(screen.getByText('US$12.34')).toBeTruthy()
  })
})
