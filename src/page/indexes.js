/** @typedef {import('../page-data.ts').IndexGaps} IndexGaps */

/**
 * @param {IndexGaps} gaps
 * @returns {readonly number[]}
 */
export function indexesOf(gaps) {
  let index = 0
  return gaps.map(gap => (index += gap))
}
