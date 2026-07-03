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

  it('ignores duplicate paths (INSERT OR IGNORE)', () => {
    const paper = { path: '/refs/dup.pdf', snippet: 's', embedding: '[0.1]', abstract_summary: 'first' }
    db.saveReferencePaper(paper)
    db.saveReferencePaper({ ...paper, abstract_summary: 'second' })

    const rows = db.getReferencePapers()
    expect(rows).toHaveLength(1)
    expect(rows[0].abstract_summary).toBe('first')
  })
})