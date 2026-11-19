import { expect, test } from 'vitest'
import { formatMoney, splitEqual } from '../src/index'

test('splits evenly', () => expect(splitEqual(900, ['a', 'b', 'c'], 'a')).toEqual({ a: 300, b: 300, c: 300 }))
test('remainder goes to payer', () => expect(splitEqual(1000, ['a', 'b', 'c'], 'b')).toEqual({ a: 333, b: 334, c: 333 }))
test('payer not in split: remainder 1¢ each in id order', () =>
  expect(splitEqual(1001, ['c', 'a', 'b'], 'z')).toEqual({ a: 334, b: 334, c: 333 }))
test('rejects amount smaller than head count', () =>
  expect(() => splitEqual(2, ['a', 'b', 'c'], 'a')).toThrow(/AMOUNT_TOO_SMALL/))
test('rejects empty and duplicate participants', () => {
  expect(() => splitEqual(100, [], 'a')).toThrow()
  expect(() => splitEqual(100, ['a', 'a'], 'a')).toThrow()
})
test('rejects non-positive or non-integer amounts', () => {
  expect(() => splitEqual(0, ['a'], 'a')).toThrow()
  expect(() => splitEqual(10.5, ['a'], 'a')).toThrow()
})
test('formats', () => expect(formatMoney(123456, 'SGD')).toBe('$1,234.56'))
