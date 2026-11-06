/**
 * Repository-controlled globs, matched by a bounded set of states rather than
 * recursive backtracking. At most 1,024 tokens are active for each path
 * character, so matching is linear in the path length even for hostile globs.
 */

const limit = 1024
const alternativeLimit = 64

type Token =
  | { readonly kind: 'literal'; readonly value: string }
  | { readonly kind: 'class'; readonly value: RegExp }
  | { readonly kind: 'star' | 'globstar' | 'directories' | 'any' }

interface Glob {
  readonly alternatives: readonly (readonly Token[])[]
  readonly problem?: string
}

function alternativesOf(pattern: string): readonly string[] {
  const open = pattern.indexOf('{')
  if (open < 0) return [pattern]
  let depth = 1
  let close = open + 1
  const pieces: string[] = []
  let start = close
  for (; close < pattern.length && depth > 0; close++) {
    const char = pattern[close]
    if (char === '{') depth++
    if (char === '}') depth--
    if ((char === ',' && depth === 1) || depth === 0) {
      pieces.push(pattern.slice(start, close))
      start = close + 1
    }
  }
  if (depth !== 0) throw new Error('unclosed brace')
  if (pieces.length === 1) {
    const range = /^(-?\d+)\.\.(-?\d+)$/.exec(pieces[0]!)
    if (!range) throw new Error('braces must contain comma alternatives or an integer range')
    const first = Number(range[1])
    const last = Number(range[2])
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last))
      throw new Error('unsafe integer range')
    if (Math.abs(last - first) >= alternativeLimit) throw new Error('too many brace alternatives')
    pieces.length = 0
    for (let value = first; ; value += first <= last ? 1 : -1) {
      pieces.push(String(value))
      if (value === last) break
    }
  }
  const expanded: string[] = []
  for (const piece of pieces) {
    expanded.push(...alternativesOf(pattern.slice(0, open) + piece + pattern.slice(close)))
    if (expanded.length > alternativeLimit || expanded.join('').length > limit) {
      throw new Error('too many brace alternatives')
    }
  }
  return expanded
}

function tokensOf(pattern: string): readonly Token[] {
  const tokens: Token[] = []
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index]!
    if (char === '*') {
      let end = index + 1
      while (pattern[end] === '*') end++
      const wholeSegment =
        (index === 0 || pattern[index - 1] === '/') &&
        (end === pattern.length || pattern[end] === '/')
      if (end - index > 1 && wholeSegment) {
        tokens.push({ kind: pattern[end] === '/' ? 'directories' : 'globstar' })
        index = end - (pattern[end] === '/' ? 0 : 1)
      } else {
        tokens.push({ kind: 'star' })
        index = end - 1
      }
    } else if (char === '?') {
      tokens.push({ kind: 'any' })
    } else if (char === '[') {
      const close = pattern.indexOf(']', index + 1)
      if (close < 0) throw new Error('unclosed character class')
      let body = pattern.slice(index + 1, close)
      if (body.includes('[') || body.includes('/')) throw new Error('unsupported character class')
      if (body.startsWith('!')) body = '^' + body.slice(1)
      tokens.push({ kind: 'class', value: new RegExp(`^[${body}]$`) })
      index = close
    } else {
      tokens.push({ kind: 'literal', value: char })
    }
  }
  return tokens
}

function compile(pattern: string): Glob {
  try {
    if (pattern.length > limit) throw new Error('more than 1,024 characters')
    if (/\\|[?*+@!]\(/.test(pattern)) throw new Error('escapes and extglobs are unsupported')
    const alternatives = alternativesOf(pattern).map(tokensOf)
    if (alternatives.reduce((sum, tokens) => sum + tokens.length, 0) > limit) {
      throw new Error('more than 1,024 tokens after brace expansion')
    }
    return { alternatives }
  } catch (error) {
    return { alternatives: [], problem: `glob ignored: ${(error as Error).message}` }
  }
}

// Bound memory as well as matching work. A repository usually has only a few
// patterns; an evicted pattern is simply compiled again, with the same limits.
const compiled = new Map<string, Glob>()
function globOf(pattern: string): Glob {
  let glob = compiled.get(pattern)
  if (glob === undefined) {
    glob = compile(pattern)
    if (compiled.size >= 128) compiled.delete(compiled.keys().next().value!)
    compiled.set(pattern, glob)
  }
  return glob
}

export function globProblem(pattern: string): string | undefined {
  return globOf(pattern).problem
}

function match(path: string, tokens: readonly Token[]): boolean {
  let active = new Set([0])
  for (let offset = 0; offset <= path.length; offset++) {
    const boundary = offset === 0 || path[offset - 1] === '/'
    // Epsilon edges only point forwards. One pass computes their closure,
    // including any sequence of stars, without recursion or revisiting states.
    for (let index = 0; index < tokens.length; index++) {
      if (!active.has(index)) continue
      const kind = tokens[index]!.kind
      if (
        (kind === 'star' && !(boundary && path[offset] === '.')) ||
        kind === 'globstar' ||
        (kind === 'directories' && boundary)
      ) {
        active.add(index + 1)
      }
    }
    if (offset === path.length) return active.has(tokens.length)
    const char = path[offset]!
    const next = new Set<number>()
    for (const index of active) {
      const token = tokens[index]
      if (token === undefined) continue
      if (token.kind === 'literal') {
        if (token.value === char) next.add(index + 1)
      } else if (!(boundary && char === '.')) {
        if (token.kind === 'directories' || token.kind === 'globstar') next.add(index)
        else if (char !== '/') {
          if (token.kind === 'star') next.add(index)
          else if (token.kind === 'any' || (token.kind === 'class' && token.value.test(char)))
            next.add(index + 1)
        }
      }
    }
    if (next.size === 0) return false
    active = next
  }
  return false
}

/** Unsupported or over-budget patterns match nothing; discovery reports why. */
export function matchesGlob(path: string, pattern: string): boolean {
  return globOf(pattern).alternatives.some(tokens => match(path, tokens))
}
