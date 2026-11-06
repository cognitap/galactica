import { User, findUser } from './user'

export interface Order {
  readonly id: string
}

export function ownerOf(order: Order): User {
  return findUser(order.id)
}
