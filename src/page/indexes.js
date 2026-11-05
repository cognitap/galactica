/** @typedef {import('../page-data.ts').IndexGaps} IndexGaps */

/**
 * The module indexes that `gaps` stores, in ascending order.
 * @param {IndexGaps} gaps
 * @returns {readonly number[]}
 */
export function indexesOf(gaps) {
  let index = 0
  return gaps.map(gap => (index += gap))
}
