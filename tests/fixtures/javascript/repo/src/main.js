import App from './App'
import { greet } from './greet.js'

export function start() {
  return App({ name: greet('ada') })
}
