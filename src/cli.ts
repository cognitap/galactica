#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

const usage = `Usage: galactica [options]

Map a JavaScript or TypeScript repository.

Options:
  --root <dir>   Repository to map (default: current directory)
  -h, --help     Show this help
  -v, --version  Show the version`

export function run(argv: string[]): { code: number; stdout: string } {
  const { values } = parseArgs({
    args: argv,
    options: {
      root: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' }
    },
    strict: true
  })

  if (values.help) return { code: 0, stdout: usage }
  if (values.version) return { code: 0, stdout: readVersion() }
  return { code: 1, stdout: 'galactica: mapping is not implemented yet' }
}

function readVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  return pkg.version
}

if (import.meta.main) {
  const result = run(process.argv.slice(2))
  console.log(result.stdout)
  process.exitCode = result.code
}
