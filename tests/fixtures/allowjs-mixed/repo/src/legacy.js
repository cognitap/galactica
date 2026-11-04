import { add } from './math.js'

export function legacyTotal(values) {
  return values.reduce(add, 0)
}
