import { expect, test } from 'vitest'
import { Price } from '../ui/Price'
import { format } from './format'

test('formats', () => {
  expect(format(1)).toBe('1.0')
  expect(Price).toBeDefined()
})
