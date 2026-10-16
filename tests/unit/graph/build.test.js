import { describe, it, expect } from 'vitest'
import {
  centerVectors, similarityMatrix, topKEdges, buildGraph,
} from '../../../src/graph/build.js'

describe('centerVectors', () => {
  it('subtracts the mean vector so the collection is centered on the origin', () => {
    const out = centerVectors([[1, 2], [3, 4]])
    expect(out).toEqual([[-1, -1], [1, 1]])
  })

  it('returns an empty array for no vectors', () => {
    expect(centerVectors([])).toEqual([])
  })

  it('does not mutate its input', () => {
    const input = [[1, 2], [3, 4]]
    centerVectors(input)
    expect(input).toEqual([[1, 2], [3, 4]])
  })

  it('spreads out vectors that all share a large common component', () => {
    // Abstracts del mismo campo: casi paralelos → coseno saturado cerca de 1.
    const raw = [[10, 1, 0], [10, 0, 1], [10, -1, 0]]
    const rawSim = similarityMatrix(raw)
    const centSim = similarityMatrix(centerVectors(raw))
    expect(rawSim[0][1]).toBeGreaterThan(0.98)
    expect(centSim[0][1]).toBeLessThan(rawSim[0][1])
  })
})

describe('similarityMatrix', () => {
  it('is symmetric with 1 on the diagonal', () => {
    const m = similarityMatrix([[1, 0], [0, 1], [1, 1]])
    expect(m[0][0]).toBeCloseTo(1)
    expect(m[0][1]).toBeCloseTo(0)
    expect(m[0][2]).toBeCloseTo(Math.SQRT1_2)
    expect(m[2][0]).toBeCloseTo(m[0][2])
  })

  it('treats a zero vector as similar to nothing', () => {
    const m = similarityMatrix([[0, 0], [1, 0]])
    expect(m[0][1]).toBe(0)
  })
})

describe('topKEdges', () => {
  // 0 y 1 parecidos, 2 y 3 parecidos, entre grupos casi nada.
  const sim = [
    [1,   0.9, 0.1, 0.0],
    [0.9, 1,   0.2, 0.1],
    [0.1, 0.2, 1,   0.8],
    [0.0, 0.1, 0.8, 1],
  ]

  it('connects each node to its k most similar neighbours', () => {
    const edges = topKEdges(sim, { k: 1 })
    const pairs = edges.map(e => [e.source, e.target].join('-')).sort()
    expect(pairs).toEqual(['0-1', '2-3'])
  })

  it('never emits a self edge and never duplicates an undirected pair', () => {
    const edges = topKEdges(sim, { k: 3 })
    expect(edges.every(e => e.source < e.target)).toBe(true)
    const keys = edges.map(e => `${e.source}-${e.target}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('guarantees no isolated node even when everything is dissimilar', () => {
    const edges = topKEdges(sim, { k: 1 })
    const touched = new Set(edges.flatMap(e => [e.source, e.target]))
    expect(touched.size).toBe(4)
  })

  it('marks an edge as mutual only when both ends chose each other', () => {
    // 0→1, 1→0 (mutuo); 2→1 pero 1 no elige a 2.
    const s = [
      [1,   0.9, 0.1],
      [0.9, 1,   0.5],
      [0.2, 0.6, 1],
    ]
    const edges = topKEdges(s, { k: 1 })
    const e01 = edges.find(e => e.source === 0 && e.target === 1)
    const e12 = edges.find(e => e.source === 1 && e.target === 2)
    expect(e01.mutual).toBe(true)
    expect(e12.mutual).toBe(false)
  })

  it('drops edges below minSimilarity', () => {
    const edges = topKEdges(sim, { k: 3, minSimilarity: 0.5 })
    const pairs = edges.map(e => `${e.source}-${e.target}`).sort()
    expect(pairs).toEqual(['0-1', '2-3'])
  })

  it('carries the similarity as the edge weight', () => {
    const edges = topKEdges(sim, { k: 1 })
    expect(edges.find(e => e.source === 0).weight).toBeCloseTo(0.9)
  })

  it('handles fewer nodes than k', () => {
    expect(topKEdges([[1, 0.5], [0.5, 1]], { k: 5 })).toHaveLength(1)
    expect(topKEdges([[1]], { k: 3 })).toEqual([])
    expect(topKEdges([], { k: 3 })).toEqual([])
  })
})

describe('buildGraph', () => {
  const node = (id, embedding, extra = {}) => ({ id, embedding, model: 'm1', ...extra })

  it('builds nodes and edges from embeddings', () => {
    const g = buildGraph([
      node('a', [1, 0.1]), node('b', [1, 0.2]), node('c', [-1, 0.1]), node('d', [-1, 0.2]),
    ], { k: 1, center: false })
    expect(g.nodes.map(n => n.id)).toEqual(['a', 'b', 'c', 'd'])
    const pairs = g.edges.map(e => `${g.nodes[e.source].id}-${g.nodes[e.target].id}`).sort()
    expect(pairs).toEqual(['a-b', 'c-d'])
  })

  it('keeps node metadata other than the embedding', () => {
    const g = buildGraph([node('a', [1, 0], { title: 'A', kind: 'reference' }), node('b', [0, 1])], { k: 1 })
    expect(g.nodes[0]).toMatchObject({ id: 'a', title: 'A', kind: 'reference' })
    expect(g.nodes[0].embedding).toBeUndefined()
  })

  it('only compares vectors from the active embedding model and reports the rest as stale', () => {
    const g = buildGraph([
      node('a', [1, 0]), node('b', [0.9, 0.1]),
      node('x', [1, 0, 0], { model: 'other' }),
    ], { k: 1, model: 'm1' })
    expect(g.nodes.map(n => n.id)).toEqual(['a', 'b'])
    expect(g.stale).toEqual(['x'])
  })

  it('skips nodes with no embedding and reports them as missing', () => {
    const g = buildGraph([node('a', [1, 0]), node('b', [0, 1]), node('z', null)], { k: 1 })
    expect(g.nodes.map(n => n.id)).toEqual(['a', 'b'])
    expect(g.missing).toEqual(['z'])
  })

  it('defaults to the most common model when none is given', () => {
    const g = buildGraph([
      node('a', [1, 0]), node('b', [0, 1]), node('x', [1, 0, 0], { model: 'rare' }),
    ], { k: 1 })
    expect(g.model).toBe('m1')
    expect(g.stale).toEqual(['x'])
  })

  it('is deterministic', () => {
    const input = [node('a', [1, 0.3]), node('b', [0.2, 1]), node('c', [0.9, 0.4]), node('d', [0.1, 0.8])]
    expect(buildGraph(input, { k: 2 })).toEqual(buildGraph(input, { k: 2 }))
  })

  it('returns an empty graph for no nodes', () => {
    expect(buildGraph([], { k: 3 })).toMatchObject({ nodes: [], edges: [], stale: [], missing: [] })
  })
})

describe('buildGraph — raw cosine on edges', () => {
  it('keeps the uncentered cosine next to the (possibly centered) weight, for display', () => {
    const nodes = [
      { id: 'a', embedding: [10, 1], model: 'm' },
      { id: 'b', embedding: [10, 2], model: 'm' },
      { id: 'c', embedding: [10, -1], model: 'm' },
    ]
    const g = buildGraph(nodes, { k: 1, center: true })
    for (const e of g.edges) {
      expect(e.cosine).toBeGreaterThan(0.9)           // crudo: casi paralelos
    }
    expect(Math.min(...g.edges.map(e => e.weight))).toBeLessThan(0.9)  // centrado: más contraste
  })
})
