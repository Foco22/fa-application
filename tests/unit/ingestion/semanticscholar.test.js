import { describe, it, expect, vi } from 'vitest'
import { getAffiliations, matchesUniversityList } from '../../../src/ingestion/semanticscholar.js'

const UNIVERSITY_LIST = [
  'MIT', 'Stanford', 'Carnegie Mellon', 'Oxford', 'Cambridge',
  'ETH Zurich', 'UC Berkeley', 'Harvard', 'Princeton', 'Caltech',
  'Columbia', 'Yale', 'University of Toronto', 'Université de Montréal',
  'NYU', 'EPFL', 'University of Washington', 'Georgia Tech',
  'University of Michigan', 'Imperial College London'
]

// ─── fixture responses ────────────────────────────────────────────────────────

const SS_RESPONSE_FOUND = {
  data: {
    authors: [
      { name: 'Yann LeCun',  affiliations: ['New York University', 'Meta AI'] },
      { name: 'John Smith',  affiliations: ['MIT'] }
    ]
  }
}

const SS_RESPONSE_NO_AFFILIATIONS = {
  data: {
    authors: [
      { name: 'Anonymous', affiliations: [] }
    ]
  }
}

// ─── getAffiliations ──────────────────────────────────────────────────────────

describe('getAffiliations', () => {
  it('returns normalized authors array on success', async () => {
    const mockHttp = { get: vi.fn().mockResolvedValue(SS_RESPONSE_FOUND) }
    const result = await getAffiliations('2401.00001', mockHttp)

    expect(result).toHaveLength(2)
    expect(result[0].name).toBe('Yann LeCun')
    expect(result[0].affiliations).toContain('New York University')
    expect(result[1].affiliations).toContain('MIT')
  })

  it('calls the correct Semantic Scholar endpoint', async () => {
    const mockHttp = { get: vi.fn().mockResolvedValue(SS_RESPONSE_FOUND) }
    await getAffiliations('2401.00001', mockHttp)

    const url = mockHttp.get.mock.calls[0][0]
    expect(url).toContain('api.semanticscholar.org/graph/v1/paper/arXiv:2401.00001')
    expect(url).toContain('fields=authors.affiliations,authors.name')
  })

  it('sends x-api-key header when apiKey is provided', async () => {
    const mockHttp = { get: vi.fn().mockResolvedValue(SS_RESPONSE_FOUND) }
    await getAffiliations('2401.00001', mockHttp, 'test-key-123')

    const config = mockHttp.get.mock.calls[0][1]
    expect(config.headers['x-api-key']).toBe('test-key-123')
  })

  it('sends no x-api-key header when apiKey is empty', async () => {
    const mockHttp = { get: vi.fn().mockResolvedValue(SS_RESPONSE_FOUND) }
    await getAffiliations('2401.00001', mockHttp, '')

    const config = mockHttp.get.mock.calls[0][1]
    expect(config.headers['x-api-key']).toBeUndefined()
  })

  it('returns null on 404 (paper not yet indexed)', async () => {
    const notFound = { response: { status: 404 } }
    const mockHttp = { get: vi.fn().mockRejectedValue(notFound) }
    const result = await getAffiliations('2401.00001', mockHttp)
    expect(result).toBeNull()
  })

  it('returns null on any other HTTP error', async () => {
    const mockHttp = { get: vi.fn().mockRejectedValue(new Error('timeout')) }
    const result = await getAffiliations('2401.00001', mockHttp)
    expect(result).toBeNull()
  })

  it('returns empty array when authors have no affiliations', async () => {
    const mockHttp = { get: vi.fn().mockResolvedValue(SS_RESPONSE_NO_AFFILIATIONS) }
    const result = await getAffiliations('2401.00001', mockHttp)
    expect(result).toHaveLength(1)
    expect(result[0].affiliations).toEqual([])
  })
})

// ─── matchesUniversityList ────────────────────────────────────────────────────

describe('matchesUniversityList', () => {
  it('returns true when affiliations is null (not found in SS — paper passes)', () => {
    expect(matchesUniversityList(null, UNIVERSITY_LIST)).toBe(true)
  })

  it('returns true when an author affiliation exactly matches a university', () => {
    const affiliations = [
      { name: 'Alice', affiliations: ['MIT'] }
    ]
    expect(matchesUniversityList(affiliations, UNIVERSITY_LIST)).toBe(true)
  })

  it('returns true when affiliation string contains the university name (partial)', () => {
    const affiliations = [
      { name: 'Alice', affiliations: ['MIT Computer Science and AI Laboratory'] }
    ]
    expect(matchesUniversityList(affiliations, UNIVERSITY_LIST)).toBe(true)
  })

  it('returns true when any author (not just the first) matches', () => {
    const affiliations = [
      { name: 'Alice', affiliations: ['Google DeepMind'] },
      { name: 'Bob',   affiliations: ['Stanford University'] }
    ]
    expect(matchesUniversityList(affiliations, UNIVERSITY_LIST)).toBe(true)
  })

  it('returns false when no affiliations match the list', () => {
    const affiliations = [
      { name: 'Alice', affiliations: ['Google DeepMind'] },
      { name: 'Bob',   affiliations: ['Meta AI Research'] }
    ]
    expect(matchesUniversityList(affiliations, UNIVERSITY_LIST)).toBe(false)
  })

  it('is case-insensitive', () => {
    const affiliations = [{ name: 'Alice', affiliations: ['mit'] }]
    expect(matchesUniversityList(affiliations, UNIVERSITY_LIST)).toBe(true)
  })

  it('returns false when affiliations array is empty (all authors have no affiliation)', () => {
    const affiliations = [{ name: 'Alice', affiliations: [] }]
    expect(matchesUniversityList(affiliations, UNIVERSITY_LIST)).toBe(false)
  })

  it('returns true when universityList is empty (no filter applied)', () => {
    const affiliations = [{ name: 'Alice', affiliations: ['Some Random Institute'] }]
    expect(matchesUniversityList(affiliations, [])).toBe(true)
  })
})
