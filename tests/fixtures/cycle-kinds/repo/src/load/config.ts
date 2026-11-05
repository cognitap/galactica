import { plugins } from './plugins'

export const defaults = { mode: 'production' }

export function resolveConfig() {
  return { ...defaults, plugins }
}
