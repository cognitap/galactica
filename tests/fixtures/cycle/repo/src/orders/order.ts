import { newId } from '../shared/id'
import { findUser } from '../users/user'

export function placeOrder(userName: string): string {
  return `${newId()}:${findUser(userName)}`
}
