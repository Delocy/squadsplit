import { expect } from 'vitest'
import { SG_PRESET, type QuickSplitDTO, type QuickSplitInput } from '@squadsplit/shared'
import { json, testApp } from './helpers'

/** The README's worked example: Dan (the owner, alice) paid; Wei Ling and Arjun owe. */
export const README_INPUT = {
  title: 'Team lunch',
  place: 'Tanjong Pagar',
  spentOn: '2026-11-19',
  ...SG_PRESET,
  people: [
    { name: 'Dan', isPayer: true },
    { name: 'Wei Ling', isPayer: false },
    { name: 'Arjun', isPayer: false },
  ],
  items: [
    { name: 'Laksa', amountCents: 1000, personIndexes: [1] },
    { name: 'Satay', amountCents: 2000, personIndexes: [0, 1, 2] },
    { name: 'Chilli crab', amountCents: 4800, personIndexes: [0, 1, 2] },
    { name: 'Char kway teow', amountCents: 850, personIndexes: [2] },
    { name: 'Iced barley (2)', amountCents: 560, personIndexes: [0, 2] },
  ],
} satisfies QuickSplitInput

type Send = ReturnType<ReturnType<typeof testApp>['as']>

/** Creates a quick split as `as` (alice by default) and returns it. */
export async function createSplit(input: object = README_INPUT, as: Send = testApp().as('alice')): Promise<QuickSplitDTO> {
  const res = await as('/quick-splits', json('POST', input))
  expect(res.status).toBe(201)
  return (await res.json()) as QuickSplitDTO
}

export const personNamed = <P extends { name: string }>(s: { people: P[] }, name: string): P => s.people.find((p) => p.name === name)!
