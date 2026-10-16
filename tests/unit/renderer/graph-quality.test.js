import { describe, it, expect } from 'vitest'
import { qualityChecks } from '../../../renderer/modules/graph-quality.js'

const metrics = (over = {}) => ({
  nodeCount: 20,
  similarity: { std: 0.12 },
  validity: { precisionAtK: null, separation: null },
  structure: { isolated: 0, giantFraction: 0.9, hubRatio: 2, reciprocity: 0.6 },
  communities: { count: 3, modularity: 0.45 },
  stability: { kJaccard: 0.7 },
  ...over,
})

const byId = (checks, id) => checks.find(c => c.id === id)

describe('qualityChecks', () => {
  it('marks a healthy graph as ok everywhere', () => {
    const checks = qualityChecks(metrics())
    expect(checks.every(c => c.status === 'ok')).toBe(true)
  })

  it('warns about isolated nodes', () => {
    const c = byId(qualityChecks(metrics({ structure: { isolated: 2, giantFraction: 0.9, hubRatio: 2, reciprocity: 0.6 } })), 'isolated')
    expect(c.status).toBe('warn')
  })

  it('warns about a hub far above the mean degree', () => {
    const c = byId(qualityChecks(metrics({ structure: { isolated: 0, giantFraction: 0.9, hubRatio: 4.5, reciprocity: 0.6 } })), 'hubs')
    expect(c.status).toBe('warn')
  })

  it('warns when modularity says there are no real communities', () => {
    expect(byId(qualityChecks(metrics({ communities: { count: 1, modularity: 0.05 } })), 'modularity').status).toBe('warn')
  })

  it('warns when the graph is unstable to a one-step change in k', () => {
    expect(byId(qualityChecks(metrics({ stability: { kJaccard: 0.4 } })), 'stability').status).toBe('warn')
  })

  it('warns when similarities are saturated (the embedding does not discriminate)', () => {
    expect(byId(qualityChecks(metrics({ similarity: { std: 0.01 } })), 'spread').status).toBe('warn')
  })

  it('adds precision@k only when labels exist', () => {
    expect(byId(qualityChecks(metrics()), 'precision')).toBeUndefined()
    const c = byId(qualityChecks(metrics({ validity: { precisionAtK: 0.4, separation: null } })), 'precision')
    expect(c.status).toBe('warn')
  })

  it('reports too few nodes instead of judging a tiny graph', () => {
    const checks = qualityChecks(metrics({ nodeCount: 4 }))
    expect(checks).toHaveLength(1)
    expect(checks[0]).toMatchObject({ id: 'too-few', status: 'info' })
  })

  it('returns no checks when there is no data', () => {
    expect(qualityChecks(null)).toEqual([])
  })
})
