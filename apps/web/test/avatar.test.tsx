import { AVATAR_ANIMALS, AVATAR_COLORS } from '@squadsplit/shared'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Avatar, animalLabel, colorLabel, lookOf, SQUAD } from '../src/design/Avatar'

afterEach(cleanup)

describe('lookOf', () => {
  it('draws the chosen animal on the chosen colour', () => {
    expect(lookOf({ animal: 'fox', color: 'peach' })).toMatchObject({ kind: 'fox', bg: AVATAR_COLORS.peach })
    expect(lookOf({ animal: 'koala', color: 'mint' })).toMatchObject({ kind: 'koala', bg: AVATAR_COLORS.mint })
  })
})

describe('Avatar', () => {
  it('renders the animal on its colour', () => {
    render(<Avatar avatar={{ animal: 'penguin', color: 'lilac' }} title="Bob" />)
    const av = screen.getByRole('img', { name: 'Bob' })
    expect(av.style.getPropertyValue('--c')).toBe(AVATAR_COLORS.lilac)
    expect(av.querySelector('svg.mascot-penguin')).toBeTruthy()
  })
})

describe('labels', () => {
  it('names every animal and colour in plain words', () => {
    expect(AVATAR_ANIMALS.map(animalLabel)).toEqual(['Bunny', 'Bear', 'Panda', 'Kitty', 'Fox', 'Hamster', 'Penguin', 'Koala'])
    expect(colorLabel('peach')).toBe('Peach')
  })
})

describe('SQUAD', () => {
  it('is the eight avatar animals, each on its own background', () => {
    expect(SQUAD.map((l) => l.kind)).toEqual([...AVATAR_ANIMALS])
    expect(new Set(SQUAD.map((l) => l.bg)).size).toBe(8)
  })
})
