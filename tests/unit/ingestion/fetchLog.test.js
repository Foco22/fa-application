import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { renderMarkdown, writeFetchLog } from '../../../src/ingestion/fetchLog.js'

const baseEntry = (overrides = {}) => ({
  id: '2401.00001',
  title: 'Test Paper',
  authors: 'Alice, Bob',
  university: null,
  selection: null,
  rerank: null,
  download: null,
  orgFilter: null,
  stage: 'selection',
  decision: 'pending',
  reason: '',
  ...overrides,
})

// ─── renderMarkdown ────────────────────────────────────────────────────────────

describe('renderMarkdown', () => {
  it('includes the generatedAt timestamp and candidate/saved counts', () => {
    const report = {
      generatedAt: '2026-07-05T09:00:00.000Z',
      stats: { totalCandidates: 2, selected: 1, saved: 1 },
      entries: [
        baseEntry({ decision: 'saved', stage: 'saved', reason: 'Guardado (status: ready)' }),
        baseEntry({ id: '2401.00002', decision: 'rejected', stage: 'selection', reason: 'No superó ningún filtro de interés' }),
      ],
    }

    const md = renderMarkdown(report)

    expect(md).toContain('2026-07-05T09:00:00.000Z')
    expect(md).toContain('2')
    expect(md).toContain('1')
  })

  it('groups saved papers separately from rejected ones, with the reason visible', () => {
    const report = {
      generatedAt: '2026-07-05T09:00:00.000Z',
      stats: { totalCandidates: 2, selected: 1, saved: 1 },
      entries: [
        baseEntry({ title: 'Saved Paper', decision: 'saved', stage: 'saved', reason: 'Guardado (status: ready)', university: 'MIT' }),
        baseEntry({ id: '2401.00002', title: 'Rejected Paper', decision: 'rejected', stage: 'selection', reason: 'No superó ningún filtro de interés (embSimRef=0.120)' }),
      ],
    }

    const md = renderMarkdown(report)

    const savedIdx    = md.indexOf('Saved Paper')
    const rejectedIdx = md.indexOf('Rejected Paper')
    expect(savedIdx).toBeGreaterThan(-1)
    expect(rejectedIdx).toBeGreaterThan(-1)
    expect(savedIdx).toBeLessThan(rejectedIdx) // saved section rendered first
    expect(md).toContain('MIT')
    expect(md).toContain('No superó ningún filtro de interés (embSimRef=0.120)')
  })

  it('shows "—" when university is not known', () => {
    const report = {
      generatedAt: '2026-07-05T09:00:00.000Z',
      stats: { totalCandidates: 1, selected: 0, saved: 0 },
      entries: [baseEntry({ decision: 'rejected', stage: 'selection', university: null })],
    }

    const md = renderMarkdown(report)

    expect(md).toContain('—')
  })
})

// ─── renderMarkdown — per-stage diagnostic columns ─────────────────────────────

describe('renderMarkdown — per-stage diagnostic columns', () => {
  it('shows the interest-filter scores for every entry, not just rejected ones', () => {
    const report = {
      generatedAt: '2026-07-05T09:00:00.000Z',
      stats: { totalCandidates: 1, selected: 1, saved: 1 },
      entries: [baseEntry({
        decision: 'saved', stage: 'saved',
        selection: { embSimRef: 0.52, embSimInterest: 0.1, kwRef: false, kwInterest: true, threshold: 0.45, passed: true },
        rerank: { rank: 2, score: 0.81 },
      })],
    }

    const md = renderMarkdown(report)

    expect(md).toContain('embSimRef=0.520')
    expect(md).toContain('kwInterest=true')
    expect(md).toContain('#2')
    expect(md).toContain('0.810')
  })

  it('shows "sin filtro configurado" when selection is null (no interest signal set up)', () => {
    const report = {
      generatedAt: '2026-07-05T09:00:00.000Z',
      stats: { totalCandidates: 1, selected: 0, saved: 0 },
      entries: [baseEntry({ selection: null })],
    }

    const md = renderMarkdown(report)

    expect(md).toContain('sin filtro configurado')
  })

  it('shows "—" for rerank when a candidate never reached the rerank step', () => {
    const report = {
      generatedAt: '2026-07-05T09:00:00.000Z',
      stats: { totalCandidates: 1, selected: 0, saved: 0 },
      entries: [baseEntry({ rerank: null })],
    }

    const md = renderMarkdown(report)

    const dataRow = md.split('\n').find(l => l.includes(baseEntry().title))
    expect(dataRow).toContain('—')
  })

  it('shows PASA/NO COINCIDE for the org filter and OK/FALLÓ for the download', () => {
    const report = {
      generatedAt: '2026-07-05T09:00:00.000Z',
      stats: { totalCandidates: 2, selected: 2, saved: 1 },
      entries: [
        baseEntry({
          id: 'a', decision: 'saved', stage: 'saved',
          download: { success: true, error: null },
          orgFilter: { applied: true, passed: true, affiliations: ['MIT'] },
        }),
        baseEntry({
          id: 'b', decision: 'rejected', stage: 'download',
          download: { success: false, error: 'timeout' },
        }),
      ],
    }

    const md = renderMarkdown(report)

    expect(md).toContain('OK')
    expect(md).toContain('PASA')
    expect(md).toContain('FALLÓ: timeout')
  })

  it('marks the org filter as "sin lista configurada" when it was not applied', () => {
    const report = {
      generatedAt: '2026-07-05T09:00:00.000Z',
      stats: { totalCandidates: 1, selected: 1, saved: 1 },
      entries: [baseEntry({ decision: 'saved', stage: 'saved', orgFilter: { applied: false } })],
    }

    const md = renderMarkdown(report)

    expect(md).toContain('sin lista configurada')
  })
})

// ─── writeFetchLog ──────────────────────────────────────────────────────────────

describe('writeFetchLog', () => {
  let tmpDir

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-fetchlog-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('writes both a .md and a .json file under <vaultDir>/fetch-logs/', () => {
    const report = {
      generatedAt: '2026-07-05T09:00:00.000Z',
      stats: { totalCandidates: 1, selected: 1, saved: 1 },
      entries: [baseEntry({ decision: 'saved', stage: 'saved' })],
    }

    const { mdPath, jsonPath } = writeFetchLog(tmpDir, report)

    expect(fs.existsSync(mdPath)).toBe(true)
    expect(fs.existsSync(jsonPath)).toBe(true)
    expect(path.dirname(mdPath)).toBe(path.join(tmpDir, 'fetch-logs'))
  })

  it('the json file round-trips the exact report object', () => {
    const report = {
      generatedAt: '2026-07-05T09:00:00.000Z',
      stats: { totalCandidates: 1, selected: 1, saved: 1 },
      entries: [baseEntry({ decision: 'saved', stage: 'saved' })],
    }

    const { jsonPath } = writeFetchLog(tmpDir, report)

    const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
    expect(parsed).toEqual(report)
  })

  it('creates the fetch-logs directory if it does not exist yet', () => {
    const nested = path.join(tmpDir, 'does', 'not', 'exist')
    const report = { generatedAt: '2026-07-05T09:00:00.000Z', stats: { totalCandidates: 0, selected: 0, saved: 0 }, entries: [] }

    const { mdPath } = writeFetchLog(nested, report)

    expect(fs.existsSync(mdPath)).toBe(true)
  })

  it('derives the filename from generatedAt so consecutive runs do not collide', () => {
    const report1 = { generatedAt: '2026-07-05T09:00:00.000Z', stats: { totalCandidates: 0, selected: 0, saved: 0 }, entries: [] }
    const report2 = { generatedAt: '2026-07-05T09:05:00.000Z', stats: { totalCandidates: 0, selected: 0, saved: 0 }, entries: [] }

    const r1 = writeFetchLog(tmpDir, report1)
    const r2 = writeFetchLog(tmpDir, report2)

    expect(r1.mdPath).not.toBe(r2.mdPath)
  })
})
