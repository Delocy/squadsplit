import { AVATAR_COLORS, type AvatarChoice, type AvatarColor } from '@squadsplit/shared'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AvatarPicker } from '../src/components/AvatarPicker'

afterEach(cleanup)

const COLORS = Object.keys(AVATAR_COLORS) as AvatarColor[]

function renderPicker(value: AvatarChoice, taken: AvatarChoice[] = []) {
  const onChange = vi.fn<(a: AvatarChoice) => void>()
  render(<AvatarPicker value={value} taken={taken} onChange={onChange} />)
  return {
    onChange,
    animal: (name: string | RegExp) => within(screen.getByRole('group', { name: 'Animal' })).getByRole('button', { name }),
    colour: (name: string | RegExp) => within(screen.getByRole('group', { name: 'Colour' })).getByRole('button', { name }),
  }
}

describe('AvatarPicker', () => {
  it('offers all eight animals and six colours, with the current choice pressed', () => {
    const { animal, colour } = renderPicker({ animal: 'fox', color: 'peach' })

    expect(within(screen.getByRole('group', { name: 'Animal' })).getAllByRole('button')).toHaveLength(8)
    expect(within(screen.getByRole('group', { name: 'Colour' })).getAllByRole('button')).toHaveLength(6)
    expect(animal('Fox').getAttribute('aria-pressed')).toBe('true')
    expect(animal('Koala').getAttribute('aria-pressed')).toBe('false')
    expect(colour('Peach').getAttribute('aria-pressed')).toBe('true')
    expect(document.body.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
  })

  it('greys out the colours someone already has with the chosen animal, labelled Taken', () => {
    const { colour } = renderPicker({ animal: 'fox', color: 'peach' }, [{ animal: 'fox', color: 'mint' }, { animal: 'bear', color: 'sky' }])

    const mint = colour(/Mint/)
    expect((mint as HTMLButtonElement).disabled).toBe(true)
    expect(mint.getAttribute('aria-label')).toBe('Mint, taken')
    expect(mint.getAttribute('title')).toBe('Taken')
    expect((colour('Sky') as HTMLButtonElement).disabled).toBe(false)
  })

  it('picks a colour', () => {
    const { colour, onChange } = renderPicker({ animal: 'fox', color: 'peach' })
    fireEvent.click(colour('Lemon'))
    expect(onChange).toHaveBeenCalledWith({ animal: 'fox', color: 'lemon' })
  })

  it('keeps the colour when picking another animal, unless that combination is taken', () => {
    const { animal, onChange } = renderPicker({ animal: 'fox', color: 'peach' }, [{ animal: 'koala', color: 'peach' }])

    fireEvent.click(animal('Bear'))
    expect(onChange).toHaveBeenLastCalledWith({ animal: 'bear', color: 'peach' })

    fireEvent.click(animal('Koala'))
    expect(onChange).toHaveBeenLastCalledWith({ animal: 'koala', color: 'lemon' })
  })

  it('greys out an animal when every colour of it is taken', () => {
    const { animal } = renderPicker({ animal: 'fox', color: 'peach' }, COLORS.map((color) => ({ animal: 'bunny', color })))

    const bunny = animal(/Bunny/)
    expect((bunny as HTMLButtonElement).disabled).toBe(true)
    expect(bunny.getAttribute('aria-label')).toBe('Bunny, taken')
  })
})
