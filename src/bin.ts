#!/usr/bin/env node
import { nodeProblem } from './node-version.ts'

// Checked before cli.ts and its imports load, so an older Node.js gets one line instead of a crash.
const problem = nodeProblem(process.versions.node)
if (problem === undefined) {
  const { main } = await import('./cli.ts')
  await main()
} else {
  console.error(`galactica: ${problem}`)
  process.exitCode = 1
}
