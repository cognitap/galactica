import assert from 'node:assert/strict'
import { test } from 'node:test'
import { orderRows } from '../src/row-order.ts'

test('two crossing links between two rows are uncrossed', () => {
  assert.deepEqual(
    orderRows(
      [
        ['a', 'b'],
        ['x', 'y']
      ],
      [
        ['a', 'y'],
        ['b', 'x']
      ]
    ),
    [
      ['b', 'a'],
      ['x', 'y']
    ]
  )
})

test('a node in the middle row follows its neighbours above and below', () => {
  assert.deepEqual(
    orderRows(
      [['top'], ['m1', 'm2', 'm3'], ['b1', 'b2', 'b3']],
      [
        ['top', 'm2'],
        ['m1', 'b3'],
        ['m2', 'b2'],
        ['m3', 'b1']
      ]
    ),
    [['top'], ['m3', 'm2', 'm1'], ['b1', 'b2', 'b3']]
  )
})

test('nodes without links keep path order, ties break by path, and links within a row are ignored', () => {
  assert.deepEqual(orderRows([['c', 'a', 'b']], [['a', 'c']]), [['a', 'b', 'c']])
  assert.deepEqual(
    orderRows(
      [['q', 'p'], ['z']],
      [
        ['q', 'z'],
        ['p', 'z']
      ]
    ),
    [['p', 'q'], ['z']]
  )
})

test('a node moves up towards a neighbour at the top of a short column', () => {
  // Columns stack from the top, so r1 sits level with m1. By its share of the column's length,
  // r1 would sit level with m2 and leave m3 where it was.
  assert.deepEqual(orderRows([['m1', 'm2', 'm3'], ['r1']], [['m3', 'r1']]), [
    ['m1', 'm3', 'm2'],
    ['r1']
  ])
})
