/** The agreed Node.js support baseline for Galactica. */
export const minimumNode = '24.1.0'

/** Why Galactica cannot run on Node.js `version`, or undefined when it can. */
export function nodeProblem(version: string): string | undefined {
  const actual = version.split('.').map(Number)
  const minimum = minimumNode.split('.').map(Number)
  const differs = minimum.findIndex((part, index) => actual[index] !== part)
  if (differs === -1 || actual[differs]! > minimum[differs]!) return undefined
  return `needs Node.js ${minimumNode} or newer, and this is Node.js ${version}`
}
