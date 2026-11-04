export interface Shape {
  readonly size: number
}

export type ShapeKind = 'circle' | 'square'

export class Circle implements Shape {
  constructor(readonly size: number) {}
}

export default function (shape: Shape): number {
  return shape.size * shape.size
}
