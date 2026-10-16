import { describe, it, expect } from 'vitest'
import {
  similarityStats, precisionAtK, separation, structureMetrics,
  detectCommunities, modularity, edgeJaccard, adjustedRandIndex, neighborOverlap,
  kStability, evaluateGraph,
} from '../../../src/graph/metrics.js'

const e = (source, target, weight = 1, mutual = true) => ({ source, target, weight, mutual })

// Dos grupos {0,1,2} y {3,4,5} con similitud alta adentro y baja afuera.
const twoBlocks = () => {
  const n = 6
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : (i < 3) === (j < 3) ? 0.9 : 0.1)))
}
const labels = ['x', 'x', 'x', 'y', 'y', 'y']

describe('similarityStats', () => {
  it('summarises the off-diagonal similarities', () => {
    const s = similarityStats([[1, 0.2, 0.4], [0.2, 1, 0.6], [0.4, 0.6, 1]])
    expect(s.min).toBeCloseTo(0.2)
    expect(s.max).toBeCloseTo(0.6)
    expect(s.mean).toBeCloseTo(0.4)
    expect(s.std).toBeGreaterThan(0)
  })

  it('returns null for fewer than two nodes', () => {
    expect(similarityStats([[1]])).toBeNull()
    expect(similarityStats([])).toBeNull()
  })

  it('exposes percentiles in order', () => {
    const s = similarityStats(twoBlocks())
    expect(s.p10).toBeLessThanOrEqual(s.p50)
    expect(s.p50).toBeLessThanOrEqual(s.p90)
  })
})

describe('precisionAtK', () => {
  it('is 1 when every neighbour shares the label', () => {
    expect(precisionAtK(twoBlocks(), labels, 2)).toBeCloseTo(1)
  })

  it('is low when neighbours are in the other group', () => {
    const inverted = twoBlocks().map(r => r.map(v => (v === 1 ? 1 : 1 - v)))
    expect(precisionAtK(inverted, labels, 2)).toBeCloseTo(0)
  })

  it('ignores unlabeled nodes as query points and as neighbours', () => {
    const l = ['x', 'x', null, 'y', 'y', null]
    expect(precisionAtK(twoBlocks(), l, 1)).toBeCloseTo(1)
  })

  it('returns null when nothing is labeled', () => {
    expect(precisionAtK(twoBlocks(), [null, null, null, null, null, null], 2)).toBeNull()
  })
})

describe('separation', () => {
  it('reports a positive gap when same-label pairs are more similar', () => {
    const s = separation(twoBlocks(), labels)
    expect(s.intra).toBeCloseTo(0.9)
    expect(s.inter).toBeCloseTo(0.1)
    expect(s.gap).toBeCloseTo(0.8)
    expect(s.auc).toBeCloseTo(1)
  })

  it('has an AUC around 0.5 when similarity is unrelated to the label', () => {
    const flat = Array.from({ length: 6 }, (_, i) => Array.from({ length: 6 }, (_, j) => (i === j ? 1 : 0.5)))
    expect(separation(flat, labels).auc).toBeCloseTo(0.5)
  })

  it('returns null without both same-label and different-label pairs', () => {
    expect(separation(twoBlocks(), ['x', 'x', 'x', 'x', 'x', 'x'])).toBeNull()
    expect(separation(twoBlocks(), ['a', 'b', 'c', 'd', 'e', 'f'])).toBeNull()
  })
})

describe('structureMetrics', () => {
  it('counts isolated nodes, components and the giant component', () => {
    const m = structureMetrics(5, [e(0, 1), e(1, 2)])
    expect(m.isolated).toBe(2)
    expect(m.components).toBe(3)
    expect(m.giantFraction).toBeCloseTo(3 / 5)
  })

  it('computes degree stats and the hub ratio', () => {
    // estrella: el 0 conecta con todos.
    const m = structureMetrics(5, [e(0, 1), e(0, 2), e(0, 3), e(0, 4)])
    expect(m.maxDegree).toBe(4)
    expect(m.meanDegree).toBeCloseTo(8 / 5)
    expect(m.hubRatio).toBeCloseTo(4 / (8 / 5))
  })

  it('computes reciprocity as the share of mutual edges', () => {
    const m = structureMetrics(4, [e(0, 1, 1, true), e(1, 2, 1, false), e(2, 3, 1, false), e(0, 3, 1, true)])
    expect(m.reciprocity).toBeCloseTo(0.5)
  })

  it('handles empty graphs without NaN', () => {
    const m = structureMetrics(0, [])
    expect(m.giantFraction).toBe(0)
    expect(m.hubRatio).toBe(0)
    expect(m.reciprocity).toBe(0)
  })
})

describe('detectCommunities / modularity', () => {
  const blockEdges = [e(0, 1, 0.9), e(1, 2, 0.9), e(0, 2, 0.9), e(3, 4, 0.9), e(4, 5, 0.9), e(3, 5, 0.9), e(2, 3, 0.1)]

  it('finds the two obvious groups', () => {
    const c = detectCommunities(6, blockEdges)
    expect(c[0]).toBe(c[1])
    expect(c[1]).toBe(c[2])
    expect(c[3]).toBe(c[4])
    expect(c[4]).toBe(c[5])
    expect(c[0]).not.toBe(c[3])
  })

  it('is deterministic', () => {
    expect(detectCommunities(6, blockEdges)).toEqual(detectCommunities(6, blockEdges))
  })

  it('gives isolated nodes their own community', () => {
    const c = detectCommunities(3, [e(0, 1)])
    expect(c[2]).not.toBe(c[0])
  })

  it('scores the right partition higher than a wrong one', () => {
    const good = modularity(6, blockEdges, [0, 0, 0, 1, 1, 1])
    const bad  = modularity(6, blockEdges, [0, 1, 0, 1, 0, 1])
    expect(good).toBeGreaterThan(0.3)
    expect(good).toBeGreaterThan(bad)
  })

  it('returns 0 modularity for a graph with no edges', () => {
    expect(modularity(3, [], [0, 1, 2])).toBe(0)
  })
})

describe('stability helpers', () => {
  it('edgeJaccard is 1 for identical edge sets regardless of order or direction', () => {
    expect(edgeJaccard([e(0, 1), e(1, 2)], [e(2, 1), e(1, 0)])).toBe(1)
  })

  it('edgeJaccard measures partial overlap', () => {
    expect(edgeJaccard([e(0, 1), e(1, 2)], [e(0, 1), e(2, 3)])).toBeCloseTo(1 / 3)
  })

  it('edgeJaccard of two empty sets is 1 (nothing changed)', () => {
    expect(edgeJaccard([], [])).toBe(1)
  })

  it('adjustedRandIndex is 1 for the same partition even with renamed labels', () => {
    expect(adjustedRandIndex([0, 0, 1, 1], [5, 5, 9, 9])).toBeCloseTo(1)
  })

  it('adjustedRandIndex is near 0 or below for unrelated partitions', () => {
    expect(adjustedRandIndex([0, 0, 1, 1], [0, 1, 0, 1])).toBeLessThanOrEqual(0.01)
  })

  it('neighborOverlap is 1 when both matrices rank neighbours the same way', () => {
    expect(neighborOverlap(twoBlocks(), twoBlocks(), 2)).toBeCloseTo(1)
  })

  it('neighborOverlap drops when the neighbourhoods differ', () => {
    const inverted = twoBlocks().map(r => r.map(v => (v === 1 ? 1 : 1 - v)))
    expect(neighborOverlap(twoBlocks(), inverted, 2)).toBeLessThan(0.5)
  })
})

describe('kStability', () => {
  it('is 1 when raising k adds no new edges (everything already linked)', () => {
    expect(kStability([[1, 0.5], [0.5, 1]], 1)).toBe(1)
  })

  it('drops when the extra neighbour changes many edges', () => {
    const sim = twoBlocks()
    const s = kStability(sim, 1)
    expect(s).toBeGreaterThan(0)
    expect(s).toBeLessThan(1)
  })
})

describe('evaluateGraph', () => {
  const graph = {
    nodes: labels.map((_, i) => ({ id: `n${i}` })),
    edges: [e(0, 1, 0.9), e(1, 2, 0.9), e(0, 2, 0.9), e(3, 4, 0.9), e(4, 5, 0.9), e(3, 5, 0.9)],
    similarity: twoBlocks(),
  }

  it('bundles validity, structure and stability metrics', () => {
    const r = evaluateGraph(graph, { labels, k: 2 })
    expect(r.nodeCount).toBe(6)
    expect(r.validity.precisionAtK).toBeCloseTo(1)
    expect(r.validity.separation.gap).toBeCloseTo(0.8)
    expect(r.structure.isolated).toBe(0)
    expect(r.structure.components).toBe(2)
    expect(r.communities.count).toBe(2)
    expect(r.communities.modularity).toBeGreaterThan(0.3)
    expect(r.stability.kJaccard).toBeGreaterThanOrEqual(0)
  })

  it('works without labels (validity metrics are null)', () => {
    const r = evaluateGraph(graph, { k: 2 })
    expect(r.validity.precisionAtK).toBeNull()
    expect(r.validity.separation).toBeNull()
  })

  it('handles an empty graph', () => {
    const r = evaluateGraph({ nodes: [], edges: [], similarity: [] }, { k: 3 })
    expect(r.nodeCount).toBe(0)
    expect(r.similarity).toBeNull()
  })
})
