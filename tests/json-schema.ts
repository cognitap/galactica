/**
 * A JSON Schema checker for the keywords `schema/galactica.config.schema.json`
 * uses, and no others: it throws on any keyword it does not know, so the schema
 * cannot grow past what the agreement test checks.
 */

type Schema = Readonly<Record<string, unknown>>

const annotations: ReadonlySet<string> = new Set([
  '$schema',
  '$id',
  '$defs',
  'title',
  'description'
])

const typeOf = (value: unknown) =>
  value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value

/** The places `value` breaks `schema`, as JSON pointers with a reason. Empty when it conforms. */
export function schemaErrors(root: Schema, value: unknown): readonly string[] {
  const errors: string[] = []
  const resolve = (ref: string): Schema => {
    if (!ref.startsWith('#/')) throw new Error(`unsupported $ref ${ref}`)
    return ref
      .slice(2)
      .split('/')
      .reduce<Schema>((node, part) => node[part] as Schema, root)
  }
  const check = (schema: Schema, value: unknown, at: string): void => {
    for (const [keyword, rule] of Object.entries(schema)) {
      if (annotations.has(keyword)) continue
      const fail = (reason: string) => errors.push(`${at || '/'}: ${reason}`)
      const record = value as Readonly<Record<string, unknown>>
      const properties = (schema.properties ?? {}) as Readonly<Record<string, Schema>>
      switch (keyword) {
        case '$ref':
          check(resolve(rule as string), value, at)
          break
        case 'type': {
          const actual = Number.isInteger(value) && rule === 'integer' ? 'integer' : typeOf(value)
          if (actual !== rule) fail(`expected ${rule as string}, got ${actual}`)
          break
        }
        case 'minimum':
          if (typeof value === 'number' && value < (rule as number)) {
            fail(`less than ${rule as number}`)
          }
          break
        case 'pattern':
          if (typeof value === 'string' && !new RegExp(rule as string).test(value)) {
            fail(`does not match ${rule as string}`)
          }
          break
        case 'minItems':
          if (Array.isArray(value) && value.length < (rule as number)) {
            fail(`fewer than ${rule as number} items`)
          }
          break
        case 'items':
          if (Array.isArray(value)) {
            value.forEach((item, index) => check(rule as Schema, item, `${at}/${index}`))
          }
          break
        case 'properties':
          if (typeOf(value) === 'object') {
            for (const [name, property] of Object.entries(properties)) {
              if (Object.hasOwn(record, name)) check(property, record[name], `${at}/${name}`)
            }
          }
          break
        case 'propertyNames':
          if (typeOf(value) === 'object') {
            for (const name of Object.keys(record)) check(rule as Schema, name, `${at}/${name}`)
          }
          break
        case 'additionalProperties':
          if (typeOf(value) === 'object') {
            for (const name of Object.keys(record).filter(
              name => !Object.hasOwn(properties, name)
            )) {
              if (rule === false) fail(`unknown property ${name}`)
              else check(rule as Schema, record[name], `${at}/${name}`)
            }
          }
          break
        default:
          throw new Error(`unsupported keyword ${keyword}`)
      }
    }
  }
  check(root, value, '')
  return errors
}
