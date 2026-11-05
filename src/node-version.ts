/**
 * The oldest Node.js Galactica runs on. Node.js 24.0 prints an
 * ExperimentalWarning on the first `path.matchesGlob` call, which 24.1.0
 * removed (nodejs/node#58236).
 */
export const minimumNode = '24.1.0'

/** Why Galactica cannot run on Node.js `version`, or undefined when it can. */
export function nodeProblem(version: string): string | undefined {
  const actual = version.split('.').map(Number)
  const minimum = minimumNode.split('.').map(Number)
  const differs = minimum.findIndex((part, index) => actual[index] !== part)
  if (differs === -1 || actual[differs]! > minimum[differs]!) return undefined
  return `needs Node.js ${minimumNode} or newer, and this is Node.js ${version}`
}
