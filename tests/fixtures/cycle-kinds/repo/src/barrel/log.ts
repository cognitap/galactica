import { Store } from './index'

export function log(message: string): void {
  console.log(message)
}

export function newStore(): Store {
  return new Store()
}
