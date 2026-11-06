import * as alpha from './a'
import Alpha from './a'
import { A } from './a'
import type { Unused } from './c'

export class B implements A {
  b?: B
  a?: alpha.A
  all?: Alpha[]
  kind?: typeof Alpha
}

export function same(left: A, right: A): boolean {
  return left === right
}
