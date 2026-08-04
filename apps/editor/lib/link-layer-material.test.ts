import { describe, expect, test } from 'bun:test'
import type { AnyNode } from '@pascal-app/core'
import { layerMaterialPatches } from './link-layer-material'

const CHOICE = { productRef: 'intm:mat_gyp', brand: 'KCC', unitPrice: 5200 }

function wall(id: string, layers: Array<Record<string, unknown>>) {
  return { id, type: 'wall', faceBands: { construction: { upper: { mode: 'assembly', layers } } } }
}

function scene(...nodes: Array<Record<string, unknown>>): Record<string, AnyNode> {
  return Object.fromEntries(nodes.map((n) => [n.id as string, n as unknown as AnyNode]))
}

const STUD_AND_BOARD = [
  { kind: 'timber-stud', thickness: 0.033 },
  { kind: 'cavity', thickness: 0.048 },
  { kind: 'gypsum-board', thickness: 0.0095 },
]

describe('linking a product to every wall behind one line', () => {
  test('the product lands on the matching layer', () => {
    const nodes = scene(wall('wall_a', STUD_AND_BOARD))
    const [patch] = layerMaterialPatches(nodes, ['wall_a'], 'gypsum-board', CHOICE)

    const layers = (patch?.patch.faceBands as { construction: Record<string, { layers: never[] }> })
      .construction.upper.layers as Array<Record<string, unknown>>
    expect(layers[2]).toMatchObject({ productRef: 'intm:mat_gyp', brand: 'KCC', unitPrice: 5200 })
  })

  // The whole point: one decision, not one per wall.
  test('every wall that fed the line is patched', () => {
    const nodes = scene(wall('wall_a', STUD_AND_BOARD), wall('wall_b', STUD_AND_BOARD))
    expect(
      layerMaterialPatches(nodes, ['wall_a', 'wall_b'], 'gypsum-board', CHOICE).map((p) => p.nodeId),
    ).toEqual(['wall_a', 'wall_b'])
  })

  test('a node repeated in the line is patched once', () => {
    const nodes = scene(wall('wall_a', STUD_AND_BOARD))
    expect(layerMaterialPatches(nodes, ['wall_a', 'wall_a'], 'gypsum-board', CHOICE)).toHaveLength(1)
  })

  test('other layers are left alone', () => {
    const nodes = scene(wall('wall_a', STUD_AND_BOARD))
    const [patch] = layerMaterialPatches(nodes, ['wall_a'], 'gypsum-board', CHOICE)
    const layers = (patch?.patch.faceBands as { construction: Record<string, { layers: never[] }> })
      .construction.upper.layers as Array<Record<string, unknown>>

    expect(layers[0]).toEqual({ kind: 'timber-stud', thickness: 0.033 })
    expect(layers[1]).toEqual({ kind: 'cavity', thickness: 0.048 })
  })

  test('bands are all stamped, since one line sums them', () => {
    const nodes = scene({
      id: 'wall_a',
      type: 'wall',
      faceBands: {
        construction: {
          lower: { mode: 'assembly', layers: [{ kind: 'gypsum-board', thickness: 0.0095 }] },
          upper: { mode: 'assembly', layers: [{ kind: 'gypsum-board', thickness: 0.0095 }] },
        },
      },
    })
    const [patch] = layerMaterialPatches(nodes, ['wall_a'], 'gypsum-board', CHOICE)
    const construction = (patch?.patch.faceBands as { construction: Record<string, { layers: Array<Record<string, unknown>> }> })
      .construction

    expect(construction.lower?.layers[0]?.productRef).toBe('intm:mat_gyp')
    expect(construction.upper?.layers[0]?.productRef).toBe('intm:mat_gyp')
  })

  test('a floor or ceiling holds a flat list, and is patched the same way', () => {
    const nodes = scene({
      id: 'slab_a',
      type: 'slab',
      construction: [{ kind: 'screed', thickness: 0.05 }, { kind: 'plywood', thickness: 0.012 }],
    })
    const [patch] = layerMaterialPatches(nodes, ['slab_a'], 'plywood', CHOICE)
    const layers = patch?.patch.construction as Array<Record<string, unknown>>

    expect(layers[1]?.productRef).toBe('intm:mat_gyp')
    expect(layers[0]).toEqual({ kind: 'screed', thickness: 0.05 })
  })
})

describe('what must not be invented', () => {
  test('a node with no such layer is not patched', () => {
    const nodes = scene(wall('wall_a', [{ kind: 'timber-stud', thickness: 0.033 }]))
    expect(layerMaterialPatches(nodes, ['wall_a'], 'gypsum-board', CHOICE)).toEqual([])
  })

  test('a node that no longer exists is skipped, not created', () => {
    expect(layerMaterialPatches(scene(), ['wall_gone'], 'gypsum-board', CHOICE)).toEqual([])
  })

  test('a node with no build-up at all is left untouched', () => {
    expect(
      layerMaterialPatches(scene({ id: 'wall_a', type: 'wall' }), ['wall_a'], 'gypsum-board', CHOICE),
    ).toEqual([])
  })
})
