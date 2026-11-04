import type { Role } from './roles'
import type { Settings, User } from './types'

export async function fetchUser(role: Role, settings: Settings): Promise<User> {
  return { name: settings.verbose ? role : '' }
}
