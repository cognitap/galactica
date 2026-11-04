import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  defaultCommand,
  installSkill,
  skillFile,
  skillPaths,
  skillTemplate,
  type SkillSource
} from '../src/skill.ts'
import { repository } from './temp-repository.ts'

const template = skillTemplate()

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

const source: SkillSource = { template, command: 'node /opt/$&/cli.js', version: '1.2.3' }
const file = skillFile(source)
const read = (root: string, path: string) => readFileSync(join(root, path), 'utf8')
const statuses = (root: string, written: string, force = false) =>
  installSkill(root, written, force).map(({ status }) => status)

test('the template names the default command, which the installed file replaces', () => {
  assert.ok(template.includes(`${defaultCommand} overview`))
  assert.ok(file.includes('`node /opt/$&/cli.js overview`'))
  assert.ok(!file.includes(defaultCommand))
})

test('the installed file is valid and records the Galactica version', () => {
  assert.deepEqual(specProblems(file, 'galactica'), [])
  assert.match(
    file,
    /^metadata:\n {2}galactica-version: "1\.2\.3"\n {2}galactica-hash: "[0-9a-f]{64}"\n---\n/m
  )
})

test('a first install writes every skill path, and a second changes nothing', t => {
  const root = repository(t, {})
  assert.deepEqual(statuses(root, file), ['created', 'created'])
  for (const path of skillPaths) assert.equal(read(root, path), file)
  assert.deepEqual(statuses(root, file), ['unchanged', 'unchanged'])
  for (const path of skillPaths) assert.equal(read(root, path), file)
})

test('a file Galactica wrote is updated to a changed template or command', t => {
  const root = repository(t, {})
  installSkill(
    root,
    skillFile({ ...source, template: template.replace('# Galactica', '# Old') }),
    false
  )
  assert.deepEqual(statuses(root, file), ['updated', 'updated'])
  for (const path of skillPaths) assert.equal(read(root, path), file)
  const local = skillFile({ ...source, command: 'node dist/cli.js', version: '1.3.0' })
  assert.deepEqual(statuses(root, local), ['updated', 'updated'])
})

test('an edited file is kept unless forced', t => {
  const root = repository(t, {})
  installSkill(root, file, false)
  const [agents, claude] = skillPaths
  const edited = read(root, claude).replace(
    '## Other commands',
    '## Our notes\n\nRun pnpm test.\n\n## Other commands'
  )
  writeFileSync(join(root, claude), edited)
  const next = skillFile({ ...source, version: '1.3.0' })
  assert.deepEqual(statuses(root, next), ['updated', 'kept'])
  assert.equal(read(root, agents), next)
  assert.equal(read(root, claude), edited)
  assert.deepEqual(statuses(root, next, true), ['unchanged', 'updated'])
  assert.equal(read(root, claude), next)
})

test('a skill of the same name that Galactica did not write is kept', t => {
  const own = '---\nname: galactica\ndescription: Ours.\n---\n'
  const root = repository(t, Object.fromEntries(skillPaths.map(path => [path, own])))
  assert.deepEqual(statuses(root, file), ['kept', 'kept'])
  for (const path of skillPaths) assert.equal(read(root, path), own)
})
