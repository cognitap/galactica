/** Runs unit and CLI tests with this Node executable; browser tests run in the primary CI job. */
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

console.log(`Running Node unit and CLI tests with ${process.version} (${process.execPath})`)
const directory = new URL('../tests/', import.meta.url)
const tests = readdirSync(directory)
  .filter(name => name.endsWith('.test.ts') && name !== 'page.test.ts')
  .sort()
  .map(name => fileURLToPath(new URL(name, directory)))
const result = spawnSync(process.execPath, ['--test', ...tests], { stdio: 'inherit' })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
