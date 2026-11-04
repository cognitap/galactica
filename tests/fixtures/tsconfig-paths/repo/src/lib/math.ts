export function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0)
}
