import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'
import ts from 'typescript'

const root = join(import.meta.dirname, '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>
}

/** The package a bare specifier names, or undefined for a relative or built-in one. */
function packageName(specifier: string): string | undefined {
  if (specifier.startsWith('.') || specifier.startsWith('/')) return undefined
  if (specifier.startsWith('node:') || builtinModules.includes(specifier)) return undefined
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

// An installed package gets only its `dependencies`, so a package that the
// built code imports and that is missing there fails on the first command.
test('every package the built code imports is a dependency', () => {
  const dist = join(root, 'dist')
  const imported = new Map<string, string>()
  for (const entry of readdirSync(dist, { recursive: true, encoding: 'utf8' })) {
    if (!entry.endsWith('.js')) continue
    const { importedFiles } = ts.preProcessFile(readFileSync(join(dist, entry), 'utf8'), true, true)
    for (const { fileName } of importedFiles) {
      const name = packageName(fileName)
      if (name !== undefined && !imported.has(name)) imported.set(name, entry)
    }
  }
  const missing = [...imported]
    .filter(([name]) => manifest.dependencies?.[name] === undefined)
    .map(([name, file]) => `${name} (imported by dist/${file})`)
  assert.deepEqual(missing, [])
  assert.ok(imported.has('typescript'))
})
