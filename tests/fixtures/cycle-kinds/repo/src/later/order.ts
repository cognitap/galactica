import { findUser } from './user'

export function placeOrder(userName: string): string {
  return `order:${findUser(userName)}`
}
