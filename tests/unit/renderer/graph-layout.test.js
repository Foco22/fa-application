import { describe, it, expect } from 'vitest'
import { layoutGraph, nodeRadius, communityColor, projectPoint, rotatePoint } from '../../../renderer/modules/graph-layout.js'

const dist = (p, a, b) => Math.hypot(p[a].x - p[b].x, p[a].y - p[b].y, p[a].z - p[b].z)
const nodes = n => Array.from({ length: n }, (_, i) => ({ id: `n${i}` }))
const norm = q => Math.hypot(q.x, q.y, q.z)

describe('layoutGraph (3D)', () => {
  it('returns one finite {x,y,z} per node', () => {
    const p = layoutGraph(nodes(5), [{ source: 0, target: 1, weight: 0.8 }])
    expect(p).toHaveLength(5)
    expect(p.every(q => [q.x, q.y, q.z].every(Number.isFinite))).toBe(true)
  })

  it('is deterministic for the same input', () => {
    const edges = [{ source: 0, target: 1, weight: 0.9 }, { source: 1, target: 2, weight: 0.5 }]
    expect(layoutGraph(nodes(4), edges)).toEqual(layoutGraph(nodes(4), edges))
  })

  it('pulls connected nodes closer than unconnected ones', () => {
    const edges = [
      { source: 0, target: 1, weight: 0.9 }, { source: 1, target: 2, weight: 0.9 }, { source: 0, target: 2, weight: 0.9 },
      { source: 3, target: 4, weight: 0.9 }, { source: 4, target: 5, weight: 0.9 }, { source: 3, target: 5, weight: 0.9 },
    ]
    const p = layoutGraph(nodes(6), edges)
    const within = (dist(p, 0, 1) + dist(p, 3, 4)) / 2
    const across = (dist(p, 0, 3) + dist(p, 1, 4)) / 2
    expect(within).toBeLessThan(across)
  })

  it('keeps stronger edges shorter than weaker ones', () => {
    const edges = [{ source: 0, target: 1, weight: 0.95 }, { source: 2, target: 3, weight: 0.2 }]
    const p = layoutGraph(nodes(4), edges)
    expect(dist(p, 0, 1)).toBeLessThan(dist(p, 2, 3))
  })

  it('does not stack nodes on the same point', () => {
    const p = layoutGraph(nodes(6), [])
    for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) expect(dist(p, i, j)).toBeGreaterThan(1)
  })

  it('is centered on the origin and fits inside the requested radius (compact, nothing glued to a wall)', () => {
    const radius = 200
    const p = layoutGraph(nodes(30), [], { radius })
    const c = p.reduce((a, q) => ({ x: a.x + q.x / 30, y: a.y + q.y / 30, z: a.z + q.z / 30 }), { x: 0, y: 0, z: 0 })
    expect(norm(c)).toBeLessThan(1)
    expect(Math.max(...p.map(norm))).toBeLessThanOrEqual(radius + 1e-6)
  })

  it('uses all three dimensions', () => {
    const p = layoutGraph(nodes(20), [])
    const spread = axis => Math.max(...p.map(q => q[axis])) - Math.min(...p.map(q => q[axis]))
    expect(spread('x')).toBeGreaterThan(10)
    expect(spread('y')).toBeGreaterThan(10)
    expect(spread('z')).toBeGreaterThan(10)
  })

  it('handles zero and one node', () => {
    expect(layoutGraph([], [])).toEqual([])
    expect(layoutGraph(nodes(1), [])).toEqual([{ x: 0, y: 0, z: 0 }])
  })
})

describe('rotatePoint', () => {
  it('is the identity at yaw 0 / pitch 0 and preserves length', () => {
    expect(rotatePoint({ x: 1, y: 2, z: 3 }, 0, 0)).toEqual({ x: 1, y: 2, z: 3 })
    const r = rotatePoint({ x: 1, y: 2, z: 3 }, 0.7, -0.4)
    expect(norm(r)).toBeCloseTo(norm({ x: 1, y: 2, z: 3 }))
  })

  it('a quarter turn of yaw sends +x to the depth axis', () => {
    const r = rotatePoint({ x: 1, y: 0, z: 0 }, Math.PI / 2, 0)
    expect(r.x).toBeCloseTo(0)
    expect(Math.abs(r.z)).toBeCloseTo(1)
  })
})

describe('projectPoint', () => {
  const cam = { distance: 800, zoom: 1, cx: 400, cy: 300 }

  it('puts the origin at the screen center', () => {
    const s = projectPoint({ x: 0, y: 0, z: 0 }, cam)
    expect(s.sx).toBeCloseTo(400)
    expect(s.sy).toBeCloseTo(300)
  })

  it('makes nearer points bigger (perspective) and reports depth', () => {
    const near = projectPoint({ x: 100, y: 0, z: 200 }, cam)
    const far  = projectPoint({ x: 100, y: 0, z: -200 }, cam)
    expect(near.factor).toBeGreaterThan(far.factor)
    expect(near.sx - 400).toBeGreaterThan(far.sx - 400)
    expect(near.z).toBeGreaterThan(far.z)
  })

  it('scales with zoom', () => {
    const a = projectPoint({ x: 50, y: 0, z: 0 }, cam)
    const b = projectPoint({ x: 50, y: 0, z: 0 }, { ...cam, zoom: 2 })
    expect(b.sx - 400).toBeCloseTo(2 * (a.sx - 400))
  })

  it('does not blow up for a point at the camera plane', () => {
    const s = projectPoint({ x: 10, y: 10, z: 800 }, cam)
    expect(Number.isFinite(s.sx) && Number.isFinite(s.sy) && Number.isFinite(s.factor)).toBe(true)
  })
})

describe('nodeRadius', () => {
  it('grows with degree but stays bounded', () => {
    expect(nodeRadius(0)).toBeLessThan(nodeRadius(5))
    expect(nodeRadius(1000)).toBeLessThanOrEqual(nodeRadius(1001))
    expect(nodeRadius(1000)).toBeLessThan(30)
  })
})

describe('communityColor', () => {
  it('gives the same color to the same community and cycles the palette', () => {
    expect(communityColor(2)).toBe(communityColor(2))
    expect(communityColor(0)).not.toBe(communityColor(1))
    expect(communityColor(100)).toMatch(/^#/)
  })
})
