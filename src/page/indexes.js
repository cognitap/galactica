/** @typedef {import('../page-data.ts').IndexGaps} IndexGaps */
/** @typedef {import('../page-data.ts').PageData} PageData */
/** @typedef {import('../contract.ts').ModuleKind} ModuleKind */
/** @typedef {import('./search.js').Target} Target */
/** @typedef {{ readonly kind: 'area' | 'module', readonly index: number }} Selection */

/**
 * @param {PageData} data
 * @param {Selection} selection
 */
export const subjectOf = (data, { kind, index }) =>
  kind === 'area' ? data.areas[index] : data.modules[index]

/**
 * The module kinds that can show a target, including a symbol's owning module.
 * @param {PageData} data
 * @param {Target} target
 * @returns {readonly ModuleKind[]}
 */
export const kindsOf = (data, target) =>
  target.kind === 'area'
    ? /** @type {ModuleKind[]} */ (Object.keys(data.areas[target.area].kinds)).filter(
        kind => data.areas[target.area].kinds[kind] > 0
      )
    : [data.modules[target.module].kind]

/**
 * @param {IndexGaps} gaps
 * @returns {readonly number[]}
 */
export function indexesOf(gaps) {
  let index = 0
  return gaps.map(gap => (index += gap))
}
