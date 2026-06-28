import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import os   from 'os'
import path from 'path'
import fs   from 'fs'
import { isoWeek, paperSlot, paperDir, ensureDirs, pdfPath, writeSummary, writeQuiz } from '../../src/vault.js'

let tmpDir

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-test-'))
})

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

const paper = {
  id:             '2401.12345',
  published_date: '2024-01-08', // ISO week 2 of 2024
  created_at:     '2024-01-10T12:00:00Z'
}

// ─── isoWeek ─────────────────────────────────────────────────────────────────

describe('isoWeek', () => {
  it('returns 1 for the first ISO week of 2024 (Jan 1)', () => {
    expect(isoWeek(new Date('2024-01-01'))).toBe(1)
  })
  it('returns 2 for Jan 8 2024', () => {
    expect(isoWeek(new Date('2024-01-08'))).toBe(2)
  })
  it('returns 52 or 53 for Dec 28 2024 (last ISO week)', () => {
    const w = isoWeek(new Date('2024-12-28'))
    expect(w).toBeGreaterThanOrEqual(52)
  })
  it('handles string dates', () => {
    expect(isoWeek('2024-06-10')).toBe(24)
  })
})

// ─── paperSlot ───────────────────────────────────────────────────────────────

describe('paperSlot', () => {
  it('returns year and zero-padded weekKey from published_date', () => {
    const slot = paperSlot(paper)
    expect(slot.year).toBe('2024')
    expect(slot.weekKey).toBe('week-02')
  })
  it('falls back to created_at when published_date is absent', () => {
    const slot = paperSlot({ id: 'x', created_at: '2024-06-10T00:00:00Z' })
    expect(slot.year).toBe('2024')
    expect(slot.weekKey).toBe('week-24')
  })
})

// ─── paperDir ────────────────────────────────────────────────────────────────

describe('paperDir', () => {
  it('returns vault/year/weekKey/id', () => {
    const dir = paperDir(tmpDir, paper)
    expect(dir).toBe(path.join(tmpDir, '2024', 'week-02', '2401.12345'))
  })
})

// ─── ensureDirs ──────────────────────────────────────────────────────────────

describe('ensureDirs', () => {
  it('creates raw/ and assets/ subdirectories', () => {
    ensureDirs(tmpDir, paper)
    const dir = paperDir(tmpDir, paper)
    expect(fs.existsSync(path.join(dir, 'raw'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'assets'))).toBe(true)
  })
  it('returns the paper dir path', () => {
    const returned = ensureDirs(tmpDir, paper)
    expect(returned).toBe(paperDir(tmpDir, paper))
  })
})

// ─── pdfPath ─────────────────────────────────────────────────────────────────

describe('pdfPath', () => {
  it('returns vault/year/weekKey/id/raw/id.pdf', () => {
    const p = pdfPath(tmpDir, paper)
    expect(p).toBe(path.join(tmpDir, '2024', 'week-02', '2401.12345', 'raw', '2401.12345.pdf'))
  })
})

// ─── writeSummary ─────────────────────────────────────────────────────────────

describe('writeSummary', () => {
  it('writes summary.md to assets/', () => {
    ensureDirs(tmpDir, paper)
    writeSummary(tmpDir, paper, '# Summary\n\nContent here.')
    const p = path.join(paperDir(tmpDir, paper), 'assets', 'summary.md')
    expect(fs.existsSync(p)).toBe(true)
    expect(fs.readFileSync(p, 'utf8')).toContain('Content here')
  })
})

// ─── writeQuiz ───────────────────────────────────────────────────────────────

describe('writeQuiz', () => {
  it('writes quiz.json to assets/', () => {
    ensureDirs(tmpDir, paper)
    const quiz = { questions: [{ question: 'Q1', options: ['A', 'B'], correct: 0 }] }
    writeQuiz(tmpDir, paper, quiz)
    const p = path.join(paperDir(tmpDir, paper), 'assets', 'quiz.json')
    expect(fs.existsSync(p)).toBe(true)
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'))
    expect(parsed.questions).toHaveLength(1)
    expect(parsed.questions[0].question).toBe('Q1')
  })
})