/** Shapes shared by JSON-reading boundaries, before a value can be used. */

export type UnknownRecord = Readonly<Record<string, unknown>>

export const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const isString = (value: unknown): value is string => typeof value === 'string'
