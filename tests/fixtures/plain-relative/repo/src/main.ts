import './setup'
import { add, PI } from './math'
import area, { Circle } from './shapes'
import { gone } from './gone'

export function main(): number {
  return add(area(new Circle(PI)), gone)
}
