import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/database.js'

let db

beforeEach(() => {
  db = openDatabase(':memory:')
})

// ─── papers ──────────────────────────────────────────────────────────────────

describe('savePaper / getPaper', () => {
  it('inserts a new paper and retrieves it by id', () => {
    const paper = {
      id: '2401.00001',
      title: 'Test Paper',
      authors: 'Alice, Bob',
      abstract: 'An abstract.',
      pdf_url: 'https://arxiv.org/pdf/2401.00001',
      published_date: '2024-01-01',
      affiliations: JSON.stringify([]),
      pdf_text: null,
      summary: null,
      quiz: null,
      pdf_error: null,
      status: 'new'
    }

    db.savePaper(paper)
    const result = db.getPaper('2401.00001')

    expect(result.id).toBe('2401.00001')
    expect(result.title).toBe('Test Paper')
    expect(result.status).toBe('new')
  })

  it('updates an existing paper on duplicate id (upsert)', () => {
    const paper = {
      id: '2401.00002', title: 'Old', authors: '', abstract: '',
      pdf_url: '', published_date: '', affiliations: '[]',
      pdf_text: null, summary: null, quiz: null, pdf_error: null, status: 'new'
    }
    db.savePaper(paper)
    db.savePaper({ ...paper, title: 'Updated', status: 'ready' })

    const result = db.getPaper('2401.00002')
    expect(result.title).toBe('Updated')
    expect(result.status).toBe('ready')
  })

  it('returns undefined for a non-existent id', () => {
    expect(db.getPaper('does-not-exist')).toBeUndefined()
  })
})

describe('getPapers', () => {
  it('returns all papers ordered by created_at descending', () => {
    const base = {
      authors: '', abstract: '', pdf_url: '', published_date: '',
      affiliations: '[]', pdf_text: null, summary: null, quiz: null,
      pdf_error: null, status: 'new'
    }
    db.savePaper({ ...base, id: 'aaa', title: 'First' })
    db.savePaper({ ...base, id: 'bbb', title: 'Second' })

    const papers = db.getPapers()
    expect(papers).toHaveLength(2)
    expect(papers[0].id).toBe('bbb')
  })

  it('returns empty array when no papers exist', () => {
    expect(db.getPapers()).toEqual([])
  })
})

describe('updatePaperStatus', () => {
  it('updates only the status field', () => {
    const paper = {
      id: '2401.00003', title: 'X', authors: '', abstract: '',
      pdf_url: '', published_date: '', affiliations: '[]',
      pdf_text: null, summary: null, quiz: null, pdf_error: null, status: 'new'
    }
    db.savePaper(paper)
    db.updatePaperStatus('2401.00003', 'ready')
    expect(db.getPaper('2401.00003').status).toBe('ready')
  })
})

// ─── settings ────────────────────────────────────────────────────────────────

describe('getSetting / saveSetting', () => {
  it('returns undefined for a key that was never set', () => {
    expect(db.getSetting('nonexistent')).toBeUndefined()
  })

  it('saves and retrieves a setting', () => {
    db.saveSetting('apiKey', 'sk-ant-test')
    expect(db.getSetting('apiKey')).toBe('sk-ant-test')
  })

  it('overwrites an existing setting', () => {
    db.saveSetting('maxPapers', '3')
    db.saveSetting('maxPapers', '5')
    expect(db.getSetting('maxPapers')).toBe('5')
  })
})

describe('getAllSettings', () => {
  it('returns all saved settings as a key→value object', () => {
    db.saveSetting('fetchDay', 'monday')
    db.saveSetting('fetchHour', '09:00')
    const settings = db.getAllSettings()
    expect(settings.fetchDay).toBe('monday')
    expect(settings.fetchHour).toBe('09:00')
  })

  it('returns empty object when no settings exist', () => {
    expect(db.getAllSettings()).toEqual({})
  })
})

// ─── quiz results ─────────────────────────────────────────────────────────────

describe('saveQuizResult / getQuizResults', () => {
  it('saves a quiz result and retrieves it', () => {
    const paper = {
      id: '2401.00010', title: 'Q Paper', authors: '', abstract: '',
      pdf_url: '', published_date: '', affiliations: '[]',
      pdf_text: null, summary: null, quiz: null, pdf_error: null, status: 'ready'
    }
    db.savePaper(paper)

    db.saveQuizResult({ paper_id: '2401.00010', score: 4, total: 5, answers: JSON.stringify([0, 1, 2, 3, 0]) })
    const results = db.getQuizResults('2401.00010')

    expect(results).toHaveLength(1)
    expect(results[0].score).toBe(4)
    expect(results[0].total).toBe(5)
  })

  it('returns multiple attempts ordered by taken_at descending', () => {
    const paper = {
      id: '2401.00011', title: 'Multi', authors: '', abstract: '',
      pdf_url: '', published_date: '', affiliations: '[]',
      pdf_text: null, summary: null, quiz: null, pdf_error: null, status: 'ready'
    }
    db.savePaper(paper)

    db.saveQuizResult({ paper_id: '2401.00011', score: 2, total: 5, answers: '[]' })
    db.saveQuizResult({ paper_id: '2401.00011', score: 5, total: 5, answers: '[]' })

    const results = db.getQuizResults('2401.00011')
    expect(results).toHaveLength(2)
    expect(results[0].score).toBe(5)
  })

  it('returns empty array when no attempts exist', () => {
    expect(db.getQuizResults('no-paper')).toEqual([])
  })
})

// ─── reference papers ─────────────────────────────────────────────────────────

describe('saveReferencePaper / getReferencePapers', () => {
  it('saves a reference paper with an abstract_summary and retrieves it', () => {
    db.saveReferencePaper({
      path: '/refs/paper1.pdf',
      snippet: 'first 3000 chars...',
      embedding: JSON.stringify([0.1, 0.2]),
      abstract_summary: 'A short summary of the paper.',
    })

    const rows = db.getReferencePapers()
    expect(rows).toHaveLength(1)
    expect(rows[0].abstract_summary).toBe('A short summary of the paper.')
  })

  it('defaults abstract_summary to null when not provided', () => {
    db.saveReferencePaper({
      path: '/refs/paper2.pdf',
      snippet: 'text',
      embedding: JSON.stringify([0.1, 0.2]),
    })

    const rows = db.getReferencePapers()
    expect(rows[0].abstract_summary).toBeNull()
  })

  it('persists the embedding_model that produced the vector', () => {
    db.saveReferencePaper({
      path: '/refs/local.pdf',
      snippet: 'text',
      embedding: JSON.stringify([0.1, 0.2]),
      embedding_model: 'local:Xenova/all-MiniLM-L6-v2',
    })

    const rows = db.getReferencePapers()
    expect(rows[0].embedding_model).toBe('local:Xenova/all-MiniLM-L6-v2')
  })

  // Filas indexadas antes de que existiera la columna: todas venían del único
  // proveedor que había entonces, así que se leen como OpenAI en vez de null.
  it('reads legacy rows with no embedding_model as the original OpenAI model', () => {
    db.saveReferencePaper({
      path: '/refs/legacy.pdf',
      snippet: 'text',
      embedding: JSON.stringify([0.1, 0.2]),
    })

    const rows = db.getReferencePapers()
    expect(rows[0].embedding_model).toBe('openai:text-embedding-3-small')
  })

  it('counts only the references embedded with the given model', () => {
    db.saveReferencePaper({ path: '/refs/a.pdf', snippet: 's', embedding: '[0.1]', embedding_model: 'local:Xenova/all-MiniLM-L6-v2' })
    db.saveReferencePaper({ path: '/refs/b.pdf', snippet: 's', embedding: '[0.1]', embedding_model: 'openai:text-embedding-3-small' })
    db.saveReferencePaper({ path: '/refs/c.pdf', snippet: 's', embedding: '[0.1]' })

    expect(db.getReferenceCount('local:Xenova/all-MiniLM-L6-v2')).toBe(1)
    expect(db.getReferenceCount('openai:text-embedding-3-small')).toBe(2)
    expect(db.getReferenceCount()).toBe(3)
  })

  it('ignores duplicate paths (INSERT OR IGNORE)', () => {
    const paper = { path: '/refs/dup.pdf', snippet: 's', embedding: '[0.1]', abstract_summary: 'first' }
    db.saveReferencePaper(paper)
    db.saveReferencePaper({ ...paper, abstract_summary: 'second' })

    const rows = db.getReferencePapers()
    expect(rows).toHaveLength(1)
    expect(rows[0].abstract_summary).toBe('first')
  })
})

// ─── learning dashboard aggregation ───────────────────────────────────────────

function makePaper(id) {
  return {
    id, title: 'T', authors: '', abstract: '', pdf_url: '', published_date: '',
    affiliations: '[]', pdf_text: null, summary: null, quiz: null, pdf_error: null, status: 'ready'
  }
}

function makeClassSession(db, paperId, { created_at, clarity_score = null, feedback = null }) {
  const { id } = db.createClassSession({ paper_id: paperId, duration: 60 })
  db.updateClassSession(id, { created_at, clarity_score, feedback })
  return id
}

describe('getClassSessionsByWeek', () => {
  it('groups finished session counts by the Monday of their week', () => {
    db.savePaper(makePaper('p1'))
    makeClassSession(db, 'p1', { created_at: '2024-01-02 10:00:00', clarity_score: 80 }) // week of 2024-01-01 (Mon)
    makeClassSession(db, 'p1', { created_at: '2024-01-03 10:00:00', clarity_score: 70 }) // same week
    makeClassSession(db, 'p1', { created_at: '2024-01-10 10:00:00', clarity_score: 90 }) // week of 2024-01-08 (Mon)

    const rows = db.getClassSessionsByWeek()

    expect(rows).toEqual([
      { week_start: '2024-01-01', count: 2 },
      { week_start: '2024-01-08', count: 1 },
    ])
  })

  it('excludes a session with null clarity_score (abandoned/incomplete session)', () => {
    db.savePaper(makePaper('p1'))
    makeClassSession(db, 'p1', { created_at: '2024-01-02 10:00:00', clarity_score: null })

    const rows = db.getClassSessionsByWeek()
    expect(rows).toEqual([])
  })

  it('counts a week with a mix of finished and abandoned sessions using only the finished ones', () => {
    db.savePaper(makePaper('p1'))
    makeClassSession(db, 'p1', { created_at: '2024-01-02 10:00:00', clarity_score: 80 })
    makeClassSession(db, 'p1', { created_at: '2024-01-03 10:00:00', clarity_score: null })

    const rows = db.getClassSessionsByWeek()
    expect(rows).toEqual([{ week_start: '2024-01-01', count: 1 }])
  })

  it('filters by from/to date range', () => {
    db.savePaper(makePaper('p1'))
    makeClassSession(db, 'p1', { created_at: '2024-01-02 10:00:00', clarity_score: 80 })
    makeClassSession(db, 'p1', { created_at: '2024-01-10 10:00:00', clarity_score: 80 })
    makeClassSession(db, 'p1', { created_at: '2024-02-01 10:00:00', clarity_score: 80 })

    const rows = db.getClassSessionsByWeek('2024-01-08', '2024-01-31')
    expect(rows).toEqual([{ week_start: '2024-01-08', count: 1 }])
  })

  it('returns an empty array when there are no sessions', () => {
    expect(db.getClassSessionsByWeek()).toEqual([])
  })
})

describe('getClassPerformanceTrend', () => {
  it('averages clarity_score, presentationScore and qaScore per week', () => {
    db.savePaper(makePaper('p1'))
    makeClassSession(db, 'p1', {
      created_at: '2024-01-02 10:00:00', clarity_score: 80,
      feedback: JSON.stringify({ presentationScore: 70, qaScore: 60 }),
    })
    makeClassSession(db, 'p1', {
      created_at: '2024-01-03 10:00:00', clarity_score: 90,
      feedback: JSON.stringify({ presentationScore: 90, qaScore: 80 }),
    })

    const rows = db.getClassPerformanceTrend()

    expect(rows).toEqual([
      { week_start: '2024-01-01', avg_clarity: 85, avg_presentation: 80, avg_qa: 70 },
    ])
  })

  it('excludes an abandoned session (null clarity_score) but keeps the week if another session finished', () => {
    db.savePaper(makePaper('p1'))
    makeClassSession(db, 'p1', { created_at: '2024-01-02 10:00:00', clarity_score: 80 })
    makeClassSession(db, 'p1', { created_at: '2024-01-03 10:00:00', clarity_score: null })

    const rows = db.getClassPerformanceTrend()
    expect(rows).toEqual([{ week_start: '2024-01-01', avg_clarity: 80, avg_presentation: null, avg_qa: null }])
  })

  it('excludes a week entirely when every session in it was abandoned', () => {
    db.savePaper(makePaper('p1'))
    makeClassSession(db, 'p1', { created_at: '2024-01-02 10:00:00', clarity_score: null })

    const rows = db.getClassPerformanceTrend()
    expect(rows).toEqual([])
  })

  it('does not throw and excludes the row when feedback JSON is malformed or absent', () => {
    db.savePaper(makePaper('p1'))
    makeClassSession(db, 'p1', { created_at: '2024-01-02 10:00:00', clarity_score: 60, feedback: 'not-json{' })
    makeClassSession(db, 'p1', { created_at: '2024-01-03 10:00:00', clarity_score: 80, feedback: null })

    const rows = db.getClassPerformanceTrend()
    expect(rows).toEqual([{ week_start: '2024-01-01', avg_clarity: 70, avg_presentation: null, avg_qa: null }])
  })

  it('returns an empty array when there are no sessions', () => {
    expect(db.getClassPerformanceTrend()).toEqual([])
  })
})

describe('getQuizPerformanceTrend', () => {
  it('averages the accuracy percentage per week', () => {
    db.savePaper(makePaper('p1'))
    db.saveQuizResult({ paper_id: 'p1', score: 4, total: 5, answers: '[]', taken_at: '2024-01-02 10:00:00' })
    db.saveQuizResult({ paper_id: 'p1', score: 5, total: 5, answers: '[]', taken_at: '2024-01-03 10:00:00' })

    const rows = db.getQuizPerformanceTrend()
    expect(rows).toEqual([{ week_start: '2024-01-01', avg_pct: 90 }])
  })

  it('averages multiple attempts within the same week into a single point', () => {
    db.savePaper(makePaper('p1'))
    db.savePaper(makePaper('p2'))
    db.saveQuizResult({ paper_id: 'p1', score: 2, total: 5, answers: '[]', taken_at: '2024-01-02 10:00:00' })
    db.saveQuizResult({ paper_id: 'p2', score: 5, total: 5, answers: '[]', taken_at: '2024-01-04 10:00:00' })

    const rows = db.getQuizPerformanceTrend()
    expect(rows).toHaveLength(1)
    expect(rows[0].avg_pct).toBe(70)
  })

  it('filters by from/to date range', () => {
    db.savePaper(makePaper('p1'))
    db.saveQuizResult({ paper_id: 'p1', score: 1, total: 5, answers: '[]', taken_at: '2024-01-02 10:00:00' })
    db.saveQuizResult({ paper_id: 'p1', score: 5, total: 5, answers: '[]', taken_at: '2024-02-01 10:00:00' })

    const rows = db.getQuizPerformanceTrend('2024-01-25', '2024-02-05')
    expect(rows).toEqual([{ week_start: '2024-01-29', avg_pct: 100 }])
  })

  it('returns an empty array when there are no quiz results', () => {
    expect(db.getQuizPerformanceTrend()).toEqual([])
  })
})

describe('getWeeklyStreak', () => {
  it('returns 0/0 when there are no class sessions', () => {
    expect(db.getWeeklyStreak()).toEqual({ current: 0, best: 0 })
  })

  it('counts consecutive completed weeks backward, stopping at the first gap', () => {
    db.savePaper(makePaper('p1'))
    makeClassSession(db, 'p1', { created_at: '2024-01-08 10:00:00', clarity_score: 80 }) // week 2024-01-08
    makeClassSession(db, 'p1', { created_at: '2024-01-15 10:00:00', clarity_score: 80 }) // week 2024-01-15
    // week 2024-01-01 has no class -> gap before that

    const result = db.getWeeklyStreak(new Date('2024-01-22T12:00:00')) // reference: week 2024-01-22, no class yet
    expect(result).toEqual({ current: 2, best: 2 })
  })

  it('counts the current week toward the streak once it already has a class', () => {
    db.savePaper(makePaper('p1'))
    makeClassSession(db, 'p1', { created_at: '2024-01-08 10:00:00', clarity_score: 80 })
    makeClassSession(db, 'p1', { created_at: '2024-01-15 10:00:00', clarity_score: 80 })
    makeClassSession(db, 'p1', { created_at: '2024-01-22 10:00:00', clarity_score: 80 })

    const result = db.getWeeklyStreak(new Date('2024-01-22T12:00:00'))
    expect(result).toEqual({ current: 3, best: 3 })
  })

  it('does not break the streak just because the in-progress current week has no class yet', () => {
    db.savePaper(makePaper('p1'))
    makeClassSession(db, 'p1', { created_at: '2024-01-15 10:00:00', clarity_score: 80 })

    const result = db.getWeeklyStreak(new Date('2024-01-22T09:00:00')) // Monday, week just started
    expect(result.current).toBe(1)
  })

  it('resets current streak to 0 once a completed week without a class has passed', () => {
    db.savePaper(makePaper('p1'))
    makeClassSession(db, 'p1', { created_at: '2024-01-08 10:00:00', clarity_score: 80 })
    // 2024-01-15 has no class, and is now a fully completed week relative to reference

    const result = db.getWeeklyStreak(new Date('2024-01-22T12:00:00'))
    expect(result.current).toBe(0)
  })

  it('tracks the best historical streak separately from the current one', () => {
    db.savePaper(makePaper('p1'))
    makeClassSession(db, 'p1', { created_at: '2024-01-01 10:00:00', clarity_score: 80 })
    makeClassSession(db, 'p1', { created_at: '2024-01-08 10:00:00', clarity_score: 80 })
    makeClassSession(db, 'p1', { created_at: '2024-01-15 10:00:00', clarity_score: 80 })
    // gap at 2024-01-22
    makeClassSession(db, 'p1', { created_at: '2024-01-29 10:00:00', clarity_score: 80 })

    const result = db.getWeeklyStreak(new Date('2024-02-01T12:00:00')) // reference: week 2024-01-29
    expect(result).toEqual({ current: 1, best: 3 })
  })

  it('does not count a week whose only session was abandoned (null clarity_score)', () => {
    db.savePaper(makePaper('p1'))
    makeClassSession(db, 'p1', { created_at: '2024-01-15 10:00:00', clarity_score: null })

    const result = db.getWeeklyStreak(new Date('2024-01-22T12:00:00'))
    expect(result).toEqual({ current: 0, best: 0 })
  })
})