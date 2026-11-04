import type { User } from './types'
import { type Role, roles } from './roles'
import { type Settings } from './types'

export async function load(settings: Settings): Promise<User> {
  const { fetchUser } = await import('./api')
  return fetchUser(roles[0] satisfies Role, settings)
}
