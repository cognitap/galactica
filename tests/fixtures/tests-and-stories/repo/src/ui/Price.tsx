import { format } from '../lib/format'

export function Price({ value }: { value: number }) {
  return <span>{format(value)}</span>
}
