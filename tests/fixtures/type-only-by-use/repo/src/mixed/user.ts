import { Order, ownerOf } from './order'

export interface User {
  readonly orders: Order[]
}

export function findUser(id: string): User {
  return { orders: [{ id }] }
}

export const isOwner = (user: User, order: Order) => ownerOf(order) === user
