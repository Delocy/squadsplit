import { describe, expect, it } from 'vitest'
import { ReceiptScanResult } from '@squadsplit/shared'
import { parseReceiptText } from '../src/receipt/parseReceiptText'

// Text as Tesseract gives it back for a phone photo: uneven spacing, the odd misread.

const BAK_KUT_TEH = `
SONG FA BAK KUT TEH
11 New Bridge Rd #01-01
GST Reg No: 201234567K
Table: 12    Pax: 4
Date: 19/11/2026 19:42
------------------------------
1 Pork Rib Soup          10.00
2 x Teh Tarik             4.40
Braised Pig Trotter      12.80
You Tiao                  3.00
Steamed Rice x3           2.40
------------------------------
Subtotal                 32.60
Service Charge 10%        3.26
GST 9%                    3.23
TOTAL                    39.09
NETS                     39.09
Change                    0.00
Thank you! Please come again
`

const CAFE = `
THE COFFEE PLACE
Tax Invoice
Item             Qty  Price   Amount
Flat White        2    5.50    11.00
Croissant         1    4.20     4.20
Iced Latte        1    6.80     6.80
Sub-Total                      22.00
GST @ 9%                        1.98
Total (S$)                     23.98
VISA **** 1234                 23.98
`

const ZI_CHAR = `
JB AH MENG
Inv#: 004512
Cereal Prawns (M)      $28.00
Sambal Kangkong        $12,00
White Bee Hoon         $22.00
Lime Juice x 3          $7.50
Sub Total              $69.50
Svc Chg                 $6.95
GST                     $6.88
Rounding               -$0.03
Grand Total            $83.30
Cash                  $100.00
Change                 $16.70
`

describe('parseReceiptText', () => {
  it('reads a restaurant receipt with service charge and GST rates, merging quantity lines', () => {
    expect(parseReceiptText(BAK_KUT_TEH)).toEqual({
      items: [
        { name: 'Pork Rib Soup', amountCents: 1000 },
        { name: 'Teh Tarik x2', amountCents: 440 },
        { name: 'Braised Pig Trotter', amountCents: 1280 },
        { name: 'You Tiao', amountCents: 300 },
        { name: 'Steamed Rice x3', amountCents: 240 },
      ],
      serviceChargeBps: 1000,
      gstBps: 900,
      totalCents: 3909,
    })
  })

  it('reads a cafe receipt with quantity and unit-price columns and GST only', () => {
    expect(parseReceiptText(CAFE)).toEqual({
      items: [
        { name: 'Flat White x2', amountCents: 1100 },
        { name: 'Croissant', amountCents: 420 },
        { name: 'Iced Latte', amountCents: 680 },
      ],
      serviceChargeBps: null,
      gstBps: 900,
      totalCents: 2398,
    })
  })

  it('works out the rates from the amounts when the receipt prints none, and reads dollar signs and comma decimals', () => {
    expect(parseReceiptText(ZI_CHAR)).toEqual({
      items: [
        { name: 'Cereal Prawns (M)', amountCents: 2800 },
        { name: 'Sambal Kangkong', amountCents: 1200 },
        { name: 'White Bee Hoon', amountCents: 2200 },
        { name: 'Lime Juice x3', amountCents: 750 },
      ],
      serviceChargeBps: 1000,
      gstBps: 900,
      totalCents: 8330,
    })
  })

  it('skips subtotal, payment, change and rounding lines', () => {
    const names = [BAK_KUT_TEH, CAFE, ZI_CHAR].flatMap((t) => parseReceiptText(t)?.items.map((i) => i.name.toLowerCase()) ?? [])
    for (const word of ['total', 'nets', 'change', 'visa', 'cash', 'rounding', 'gst', 'service', 'svc']) {
      expect(names.filter((n) => n.includes(word))).toEqual([])
    }
  })

  it('ignores GST that is already included in the prices', () => {
    const result = parseReceiptText('Chicken Rice   5.50\nKopi O   1.60\nTotal   7.10\nGST 9% incl.   0.59\n')
    expect(result).toEqual({
      items: [
        { name: 'Chicken Rice', amountCents: 550 },
        { name: 'Kopi O', amountCents: 160 },
      ],
      serviceChargeBps: null,
      gstBps: null,
      totalCents: 710,
    })
  })

  it('always returns something the scan contract accepts', () => {
    for (const text of [BAK_KUT_TEH, CAFE, ZI_CHAR]) expect(ReceiptScanResult.safeParse(parseReceiptText(text)).success).toBe(true)
  })

  it('returns null when nothing looks like an item', () => {
    expect(parseReceiptText('')).toBeNull()
    expect(parseReceiptText('|||  ~~\n  THANK YOU  \nTOTAL 12.00\nCash 20.00\n')).toBeNull()
  })
})
