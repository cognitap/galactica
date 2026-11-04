import { log } from '#internal/log'
import { slugify } from '@acme/self/utils'

export function title(text: string): string {
  log(text)
  return slugify(text)
}
