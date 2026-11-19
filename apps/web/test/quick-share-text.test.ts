import { describe, expect, it } from 'vitest'
import { chargesMath, dayLabel, shareCardText } from '../src/quick/format'
import { readmeSplit } from './quick-fixtures'

const LINK = 'https://squadsplit.pages.dev/s/7fK2qa'

describe('the share card as text', () => {
  it('matches the mockup (5b) for the README example, ending with the link', () => {
    expect(shareCardText(readmeSplit(), LINK)).toBe(
      [
        'Team lunch, Tanjong Pagar (Thu 19 Nov)',
        'Dan paid $110.43',
        '',
        'Dan: $30.55 (paid)',
        '  Satay ÷3, Chilli crab ÷3, Iced barley (2) ÷2',
        'Wei Ling: $39.16',
        '  Laksa, Satay ÷3, Chilli crab ÷3',
        'Arjun: $40.72',
        '  Satay ÷3, Chilli crab ÷3, Char kway teow, Iced barley (2) ÷2',
        '',
        'Incl. 10% service, then 9% GST (dishes x 1.199).',
        'Pay Dan: Wei Ling $39.16, Arjun $40.72',
        `Tick when you've paid: ${LINK}`,
      ].join('\n'),
    )
  })

  it('leaves out the place when there is none, and names only the charges that are on', () => {
    const gstOnly = shareCardText(readmeSplit({ place: null, serviceChargeBps: 0 }), LINK).split('\n')
    expect(gstOnly[0]).toBe('Team lunch (Thu 19 Nov)')
    expect(gstOnly).toContain('Incl. 9% GST (dishes x 1.09).')
    const serviceOnly = shareCardText(readmeSplit({ gstBps: 0 }), LINK).split('\n')
    expect(serviceOnly).toContain('Incl. 10% service (dishes x 1.1).')
    const none = shareCardText(readmeSplit({ serviceChargeBps: 0, gstBps: 0 }), LINK)
    expect(none).not.toMatch(/Incl\./)
  })
})

describe('the charges line', () => {
  it('spells out the README sums', () => {
    expect(chargesMath(readmeSplit())).toBe('Dishes $92.10 + 10% service $9.21 + 9% GST $9.12 = $110.43')
  })

  it('lists only the charges that are on', () => {
    expect(chargesMath(readmeSplit({ serviceChargeBps: 0, serviceChargeCents: 0, gstCents: 829, totalCents: 10039 }))).toBe(
      'Dishes $92.10 + 9% GST $8.29 = $100.39',
    )
    expect(chargesMath(readmeSplit({ serviceChargeBps: 0, gstBps: 0, serviceChargeCents: 0, gstCents: 0, totalCents: 9210 }))).toBe(
      'Dishes $92.10, no service charge or GST',
    )
  })
})

describe('dayLabel', () => {
  it('writes a date the short way, whatever the time zone', () => {
    expect(dayLabel('2026-11-19')).toBe('Thu 19 Nov')
    expect(dayLabel('2027-01-01')).toBe('Fri 1 Jan')
  })
})
