import { Price } from '../../src/ui/Price'

export function PriceList() {
  return (
    <ul>
      <li><Price value={1} /></li>
      <li><Price value={2} /></li>
    </ul>
  )
}
