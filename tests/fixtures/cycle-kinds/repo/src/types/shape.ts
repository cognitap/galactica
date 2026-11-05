import type { Circle } from './circle'

export interface Shape {
  readonly kind: string
}

export function isCircle(shape: Shape): shape is Circle {
  return shape.kind === 'circle'
}
