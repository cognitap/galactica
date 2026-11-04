import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const template = readFileSync(new URL('../skills/galactica/SKILL.md', import.meta.url), 'utf8')

/**
 * What the Agent Skills specification (https://agentskills.io/specification)
 * finds wrong with a SKILL.md in the folder `folder`. It reads only the YAML
 * this repository writes: one-line plain or double-quoted values, and a
 * `metadata` map of quoted strings, so any other line is a problem.
 */
function specProblems(text: string, folder: string): readonly string[] {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text)
  if (match === null) return ['no frontmatter']
  const yaml = match[1]!
  const body = match[2]!
  const fields = new Map<string, string>()
  const problems: string[] = []
  let inMetadata = false
  for (const line of yaml.split('\n')) {
    if (inMetadata && /^ {2}[a-z-]+: "[^"\\]*"$/.test(line)) continue
    const entry = /^([a-z-]+):(?: (.*))?$/.exec(line)
    if (entry === null) {
      problems.push(`unreadable line: ${line}`)
      continue
    }
    const key = entry[1]!
    const value = entry[2]
    inMetadata = key === 'metadata' && value === undefined
    if (value === undefined) {
      if (!inMetadata) problems.push(`${key} has no value`)
      continue
    }
    const quoted = /^"([^"\\]*)"$/.exec(value)
    if (quoted === null && /^["'&*!|>%@`#[\]{},?-]|: | #/.test(value)) {
      problems.push(`${key} needs quoting`)
    }
    fields.set(key, quoted?.[1] ?? value)
  }
  const name = fields.get('name') ?? ''
  const description = fields.get('description') ?? ''
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) || name.length > 64) {
    problems.push(`invalid name ${name}`)
  }
  if (name !== folder) problems.push(`name ${name} is not the folder ${folder}`)
  if (description.length < 1 || description.length > 1024) {
    problems.push(`description has ${description.length} characters`)
  }
  const known = new Set(['name', 'description', 'license', 'compatibility', 'metadata'])
  for (const key of fields.keys()) if (!known.has(key)) problems.push(`unknown field ${key}`)
  if (body.split('\n').length > 500) problems.push('body over 500 lines')
  return problems
}

test('the skill template is valid per the Agent Skills specification', () => {
  assert.deepEqual(specProblems(template, 'galactica'), [])
})

test('the validator catches what the specification forbids', () => {
  const skill = (frontmatter: string) => `---\n${frontmatter}\n---\nBody\n`
  assert.deepEqual(specProblems('# No frontmatter\n', 'x'), ['no frontmatter'])
  assert.deepEqual(specProblems(skill('name: Bad--Name\ndescription: d'), 'Bad--Name'), [
    'invalid name Bad--Name'
  ])
  assert.deepEqual(specProblems(skill('name: other\ndescription: d'), 'galactica'), [
    'name other is not the folder galactica'
  ])
  assert.deepEqual(specProblems(skill(`name: x\ndescription: ${'d'.repeat(1025)}`), 'x'), [
    'description has 1025 characters'
  ])
  assert.deepEqual(specProblems(skill('name: x\ndescription: Use: when'), 'x'), [
    'description needs quoting'
  ])
})
