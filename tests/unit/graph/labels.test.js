import { describe, it, expect } from 'vitest'
import { labelCommunities, tokenize } from '../../../src/graph/labels.js'

const node = (title, abstract = '') => ({ title, abstract })

const nodes = [
  node('Sparse mixture of experts routing', 'We study expert routing and load balancing in sparse mixture of experts models.'),
  node('Expert capacity in MoE layers', 'Expert routing capacity and token dropping for mixture of experts transformers.'),
  node('Diffusion models for images', 'Denoising diffusion models generate images; we improve the diffusion sampler.'),
  node('Fast diffusion sampling', 'A faster sampler for diffusion based image generation with fewer denoising steps.'),
]
const membership = [0, 0, 1, 1]

describe('tokenize', () => {
  it('lowercases, drops stopwords, short tokens and numbers', () => {
    const toks = tokenize('The 3 Models of Diffusion, and a NEW approach!')
    expect(toks).toContain('diffusion')
    expect(toks).not.toContain('the')
    expect(toks).not.toContain('and')
    expect(toks).not.toContain('3')
    expect(toks).not.toContain('new')
  })

  it('splits on punctuation and hyphens', () => {
    expect(tokenize('state-of-the-art routing')).toContain('routing')
  })
})

describe('labelCommunities', () => {
  it('names each community with terms that distinguish it from the others', () => {
    const labels = labelCommunities(nodes, membership)
    const a = labels.find(l => l.id === 0), b = labels.find(l => l.id === 1)
    expect(a.terms).toContain('expert')
    expect(b.terms).toContain('diffusion')
    expect(a.terms).not.toContain('diffusion')
  })

  it('reports the size of each community and sorts the biggest first', () => {
    const labels = labelCommunities([...nodes, node('Another diffusion paper', 'diffusion sampler')], [0, 0, 1, 1, 1])
    expect(labels.map(l => l.size)).toEqual([3, 2])
    expect(labels[0].id).toBe(1)
  })

  it('builds a short readable label from the top terms', () => {
    const [first] = labelCommunities(nodes, membership, { terms: 2 })
    expect(first.terms).toHaveLength(2)
    expect(first.label).toBe(first.terms.join(' · '))
  })

  it('does not repeat a term across the labels of different communities', () => {
    const labels = labelCommunities(nodes, membership)
    const all = labels.flatMap(l => l.terms)
    expect(new Set(all).size).toBe(all.length)
  })

  it('falls back to the title when a node has no abstract', () => {
    const labels = labelCommunities([node('Quantum annealing'), node('Quantum annealing schedules')], [0, 0])
    expect(labels[0].terms).toContain('quantum')
  })

  it('still labels when there is a single community', () => {
    const labels = labelCommunities(nodes, [0, 0, 0, 0])
    expect(labels).toHaveLength(1)
    expect(labels[0].terms.length).toBeGreaterThan(0)
  })

  it('is deterministic and handles empty input', () => {
    expect(labelCommunities(nodes, membership)).toEqual(labelCommunities(nodes, membership))
    expect(labelCommunities([], [])).toEqual([])
  })

  it('gives an empty label rather than crashing when nothing is usable', () => {
    const labels = labelCommunities([node('', ''), node('', '')], [0, 0])
    expect(labels[0].label).toBe('')
  })
})

describe('tokenize — filler words', () => {
  it('drops adverbs and generic academic filler so labels name topics, not style', () => {
    const toks = tokenize('We significantly improve results; this description provides various key insights, including recently')
    for (const w of ['significantly', 'recently', 'description', 'provide', 'key', 'including']) {
      expect(toks).not.toContain(w)
    }
  })
})
