import { placeOrder } from '../orders/order'

export function findUser(name: string): string {
  return name
}

export function reorder(name: string): string {
  return placeOrder(name)
}
