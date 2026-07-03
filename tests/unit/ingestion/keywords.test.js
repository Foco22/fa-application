import { describe, it, expect } from 'vitest'
import { extractKeywords, keywordOverlap } from '../../../src/ingestion/keywords.js'

// ─── extractKeywords ────────────────────────────────────────────────────────

describe('extractKeywords', () => {
  it('returns [] for empty text', () => {
    expect(extractKeywords('')).toEqual([])
    expect(extractKeywords('   ')).toEqual([])
  })

  it('returns an array of strings', () => {
    const result = extractKeywords('We study diffusion models for image generation.')
    expect(Array.isArray(result)).toBe(true)
    result.forEach(k => expect(typeof k).toBe('string'))
  })

  it('does not return common stopwords as standalone keywords', () => {
    const result = extractKeywords('The model is trained with the data and then evaluated on the test set.')
    expect(result).not.toContain('the')
    expect(result).not.toContain('and')
    expect(result).not.toContain('with')
  })

  it('ranks a repeated meaningful phrase above single-mention noise', () => {
    const text = `
      Diffusion models have become the dominant approach for image generation.
      In this paper we improve diffusion models by introducing a new noise schedule.
      Our diffusion models outperform prior work on standard benchmarks.
      We also mention a minor detail about hardware once.
    `
    const result = extractKeywords(text, 5)
    expect(result.some(k => k.includes('diffusion'))).toBe(true)
    // "diffusion models" should rank ahead of a phrase mentioned only once
    const diffusionIdx  = result.findIndex(k => k.includes('diffusion'))
    const hardwareIdx    = result.findIndex(k => k.includes('hardware'))
    if (hardwareIdx !== -1) expect(diffusionIdx).toBeLessThan(hardwareIdx)
  })

  it('respects the maxKeywords parameter', () => {
    const text = 'Alpha beta. Gamma delta. Epsilon zeta. Eta theta. Iota kappa. Lambda mu.'
    const result = extractKeywords(text, 3)
    expect(result.length).toBeLessThanOrEqual(3)
  })

  it('defaults to at most 8 keywords when maxKeywords is not passed', () => {
    const text = 'Alpha beta. Gamma delta. Epsilon zeta. Eta theta. Iota kappa. Lambda mu. Nu xi. Omicron pi. Rho sigma.'
    const result = extractKeywords(text)
    expect(result.length).toBeLessThanOrEqual(8)
  })

  it('does not duplicate the same phrase', () => {
    const text = 'Diffusion models. Diffusion models. Diffusion models are great.'
    const result = extractKeywords(text, 8)
    const unique = new Set(result)
    expect(unique.size).toBe(result.length)
  })
})

// ─── keywordOverlap ─────────────────────────────────────────────────────────

describe('keywordOverlap', () => {
  it('returns true when a keyword literally appears in the text (case-insensitive)', () => {
    expect(keywordOverlap('This paper studies Diffusion Models.', ['diffusion models'])).toBe(true)
  })

  it('returns false when none of the keywords appear', () => {
    expect(keywordOverlap('This paper studies reinforcement learning.', ['diffusion models', 'causal inference'])).toBe(false)
  })

  it('returns false for an empty keyword list', () => {
    expect(keywordOverlap('Some abstract text.', [])).toBe(false)
  })

  it('returns false for empty or missing text', () => {
    expect(keywordOverlap('', ['diffusion'])).toBe(false)
    expect(keywordOverlap(null, ['diffusion'])).toBe(false)
  })

  it('ignores blank entries in the keyword list', () => {
    expect(keywordOverlap('Diffusion models are useful.', ['', '   ', 'diffusion'])).toBe(true)
  })

  it('matches as a substring, not requiring exact word boundaries', () => {
    expect(keywordOverlap('Transformers revolutionized NLP.', ['transformer'])).toBe(true)
  })
})
