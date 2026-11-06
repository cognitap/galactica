import { label } from './index'

export class Shape {
  constructor(readonly sides: number) {}
}

export const describe = (shape: Shape) => `${label}: ${shape.sides}`
