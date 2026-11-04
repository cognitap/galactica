import { greet } from './greet'

export default function App({ name }) {
  return <h1>{greet(name)}</h1>
}
