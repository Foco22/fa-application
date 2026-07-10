import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import os   from 'os'
import path from 'path'
import fs   from 'fs'
import { isoWeek, paperSlot, paperDir, ensureDirs, pdfPath, writeSummary, writeQuiz, slidesDir, writeSlide, backfillSlideDirs, migratePaperFolders, paperFolderName, sanitizeFolderName } from '../../src/vault.js'

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
  it('returns vault/year/weekKey/id when the paper has no title', () => {
    const dir = paperDir(tmpDir, paper)
    const { year, weekKey } = paperSlot(paper)
    expect(dir).toBe(path.join(tmpDir, year, weekKey, '2401.12345'))
  })
  it('names ingesta papers by their title', () => {
    const dir = paperDir(tmpDir, { ...paper, title: 'A Great Paper' })
    const { year, weekKey } = paperSlot(paper)
    expect(dir).toBe(path.join(tmpDir, year, weekKey, 'A Great Paper'))
  })
  it('routes reference papers by their title into vault/reference/<title>', () => {
    const dir = paperDir(tmpDir, { id: 'ref-1706.03762v7', title: 'Attention Is All You Need' })
    expect(dir).toBe(path.join(tmpDir, 'reference', 'Attention Is All You Need'))
  })
  it('falls back to the id for reference papers without a title', () => {
    const dir = paperDir(tmpDir, { id: 'ref-2507.11181v2' })
    expect(dir).toBe(path.join(tmpDir, 'reference', 'ref-2507.11181v2'))
  })
})

// ─── sanitizeFolderName / referenceFolderName ────────────────────────────────

describe('sanitizeFolderName', () => {
  it('strips filesystem-invalid characters', () => {
    expect(sanitizeFolderName('A/B:C*D?"E"|F')).toBe('A B C D E F')
  })
  it('collapses whitespace and trims trailing dots/spaces', () => {
    expect(sanitizeFolderName('  Hello   World.  ')).toBe('Hello World')
  })
  it('falls back to "untitled" for an all-invalid name', () => {
    expect(sanitizeFolderName('///')).toBe('untitled')
  })
})

describe('paperFolderName', () => {
  it('returns the sanitized title when present', () => {
    expect(paperFolderName({ id: 'ref-x', title: 'Deep Learning: A Review' })).toBe('Deep Learning A Review')
  })
  it('falls back to the id when there is no title', () => {
    expect(paperFolderName({ id: 'ref-x', title: '  ' })).toBe('ref-x')
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
  it('creates the slides/ subdirectory', () => {
    ensureDirs(tmpDir, paper)
    const dir = paperDir(tmpDir, paper)
    expect(fs.existsSync(path.join(dir, 'slides'))).toBe(true)
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

// ─── slidesDir ───────────────────────────────────────────────────────────────

describe('slidesDir', () => {
  it('returns the paper dir with a slides/ suffix', () => {
    const p = slidesDir(tmpDir, paper)
    expect(p).toBe(path.join(paperDir(tmpDir, paper), 'slides'))
  })
})

// ─── writeSlide ──────────────────────────────────────────────────────────────

describe('writeSlide', () => {
  it('writes a slide file to slides/ and returns its path', () => {
    const buf = Buffer.from('fake-jpeg-bytes')
    const dest = writeSlide(tmpDir, paper, 'slide-01.jpg', buf)
    expect(dest).toBe(path.join(slidesDir(tmpDir, paper), 'slide-01.jpg'))
    expect(fs.existsSync(dest)).toBe(true)
    expect(fs.readFileSync(dest)).toEqual(buf)
  })
  it('creates slides/ if it does not exist yet', () => {
    const fresh = { id: '2402.00001', published_date: '2024-01-08' }
    const dest = writeSlide(tmpDir, fresh, 'slide-01.jpg', Buffer.from('x'))
    expect(fs.existsSync(dest)).toBe(true)
  })
})

// ─── backfillSlideDirs ───────────────────────────────────────────────────────

describe('backfillSlideDirs', () => {
  let root
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-backfill-')) })
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }) })

  function makePaperDir(rel, subdirs) {
    const dir = path.join(root, ...rel)
    for (const s of subdirs) fs.mkdirSync(path.join(dir, s), { recursive: true })
    return dir
  }

  it('creates slides/ in existing paper dirs that have raw/ or assets/ but lack it', () => {
    const p1 = makePaperDir(['2026', 'week-27', '2607.03738'], ['raw', 'assets'])
    const p2 = makePaperDir(['2026', 'week-28', 'ref-2507.11181v2'], ['assets'])

    const res = backfillSlideDirs(root)

    expect(fs.existsSync(path.join(p1, 'slides'))).toBe(true)
    expect(fs.existsSync(path.join(p2, 'slides'))).toBe(true)
    expect(res.created).toBe(2)
  })

  it('is idempotent — does not recreate slides/ that already exist', () => {
    makePaperDir(['2026', 'week-27', '2607.03738'], ['raw', 'assets', 'slides'])
    const res = backfillSlideDirs(root)
    expect(res.created).toBe(0)
  })

  it('ignores fetch-logs/ and dirs that are not paper dirs', () => {
    fs.mkdirSync(path.join(root, 'fetch-logs'), { recursive: true })
    fs.writeFileSync(path.join(root, 'fetch-logs', 'log.md'), 'x')
    makePaperDir(['2026', 'week-27', '2607.03738'], ['raw', 'assets'])

    const res = backfillSlideDirs(root)

    expect(res.created).toBe(1)
    expect(fs.existsSync(path.join(root, 'fetch-logs', 'slides'))).toBe(false)
  })

  it('returns created 0 when the vault dir does not exist', () => {
    const res = backfillSlideDirs(path.join(root, 'nope'))
    expect(res.created).toBe(0)
  })
})

// ─── migratePaperFolders ─────────────────────────────────────────────────────

describe('migratePaperFolders', () => {
  let root
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-migrate-')) })
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }) })

  const ingesta = { id: '2607.03964', title: 'Worldscape MoE', published_date: '2026-07-01' }
  const attention = { id: 'ref-1706.03762v7', title: 'Attention Is All You Need' }
  const moe = { id: 'ref-2507.11181v2', title: 'Mixture of Experts in Large Language Models' }

  it('renames an ingesta folder from its id to its title, in place', () => {
    const from = paperDir(root, { id: ingesta.id, published_date: ingesta.published_date }) // id-named
    fs.mkdirSync(path.join(from, 'assets'), { recursive: true })
    fs.writeFileSync(path.join(from, 'assets', 'quiz.json'), '{}')

    const res = migratePaperFolders(root, [ingesta])

    const to = paperDir(root, ingesta) // title-named, same week
    expect(fs.existsSync(from)).toBe(false)
    expect(fs.existsSync(path.join(to, 'assets', 'quiz.json'))).toBe(true)
    expect(res.moved).toBe(1)
  })

  it('moves a ref- dir from a week folder into reference/<title>', () => {
    const from = path.join(root, '2026', 'week-28', 'ref-2507.11181v2')
    fs.mkdirSync(path.join(from, 'assets'), { recursive: true })
    fs.writeFileSync(path.join(from, 'assets', 'quiz.json'), '{}')

    const res = migratePaperFolders(root, [moe])

    const to = path.join(root, 'reference', 'Mixture of Experts in Large Language Models')
    expect(fs.existsSync(from)).toBe(false)
    expect(fs.existsSync(path.join(to, 'assets', 'quiz.json'))).toBe(true)
    expect(res.moved).toBe(1)
  })

  it('renames a ref- dir already under reference/ to its title', () => {
    fs.mkdirSync(path.join(root, 'reference', 'ref-2507.11181v2', 'assets'), { recursive: true })
    const res = migratePaperFolders(root, [moe])
    expect(fs.existsSync(path.join(root, 'reference', 'Mixture of Experts in Large Language Models'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'reference', 'ref-2507.11181v2'))).toBe(false)
    expect(res.moved).toBe(1)
  })

  it('removes the week/year folder left empty after moving a ref paper out', () => {
    fs.mkdirSync(path.join(root, '2026', 'week-28', 'ref-2507.11181v2', 'assets'), { recursive: true })
    migratePaperFolders(root, [moe])
    expect(fs.existsSync(path.join(root, '2026', 'week-28'))).toBe(false)
    expect(fs.existsSync(path.join(root, '2026'))).toBe(false)
  })

  it('leaves orphan folders (no DB paper) untouched', () => {
    const orphan = path.join(root, '2026', 'week-27', '2607.03738')
    fs.mkdirSync(path.join(orphan, 'raw'), { recursive: true })
    const res = migratePaperFolders(root, []) // not in DB
    expect(fs.existsSync(orphan)).toBe(true)
    expect(res.moved).toBe(0)
  })

  it('is idempotent — leaves already-title-named folders in place', () => {
    fs.mkdirSync(path.join(root, 'reference', 'Attention Is All You Need', 'assets'), { recursive: true })
    const res = migratePaperFolders(root, [attention])
    expect(res.moved).toBe(0)
  })

  it('returns moved 0 when the vault dir does not exist', () => {
    const res = migratePaperFolders(path.join(root, 'nope'), [moe])
    expect(res.moved).toBe(0)
  })
})