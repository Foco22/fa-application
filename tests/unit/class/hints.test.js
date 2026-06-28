import { describe, it, expect, vi } from 'vitest'
import { findExcerpts, buildGuidance, buildAnswer, generateHint } from '../../../src/class/hints.js'

const PAPER = {
  id: '2401.00001',
  title: 'Test Paper',
  authors: 'Alice',
  abstract: 'This paper studies X.',
  pdf_text: 'The main contribution is a novel algorithm. The algorithm achieves 95% accuracy. We used a dataset of 10,000 samples.',
}

const QUESTION = '¿Cuál es la principal contribución del paper?'
const MISSING   = 'No mencionó la precisión alcanzada ni el tamaño del dataset'
const HISTORY   = [{ question: QUESTION, answer: 'Es un algoritmo nuevo.' }]

function makeLLM(response) {
  return { chat: vi.fn().mockResolvedValue(response) }
}

// ── findExcerpts ──────────────────────────────────────────────────────────────

describe('findExcerpts', () => {
  it('returns array of strings from LLM JSON response', async () => {
    const llm = makeLLM('{"excerpts": ["The algorithm achieves 95% accuracy", "We used a dataset of 10,000 samples"]}')
    const result = await findExcerpts({ paperText: PAPER.pdf_text, question: QUESTION, history: HISTORY, missing: MISSING }, llm)
    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBe(2)
    expect(result[0]).toBe('The algorithm achieves 95% accuracy')
  })

  it('handles JSON wrapped in markdown fences', async () => {
    const llm = makeLLM('```json\n{"excerpts": ["novel algorithm"]}\n```')
    const result = await findExcerpts({ paperText: PAPER.pdf_text, question: QUESTION, history: HISTORY, missing: MISSING }, llm)
    expect(result).toEqual(['novel algorithm'])
  })

  it('returns empty array as fallback when LLM fails', async () => {
    const llm = { chat: vi.fn().mockRejectedValue(new Error('API error')) }
    const result = await findExcerpts({ paperText: PAPER.pdf_text, question: QUESTION, history: HISTORY, missing: MISSING }, llm)
    expect(result).toEqual([])
  })

  it('returns empty array when LLM returns malformed JSON', async () => {
    const llm = makeLLM('not valid json')
    const result = await findExcerpts({ paperText: PAPER.pdf_text, question: QUESTION, history: HISTORY, missing: MISSING }, llm)
    expect(result).toEqual([])
  })

  it('calls LLM with paper text, question and professor answer in the prompt', async () => {
    const llm = makeLLM('{"excerpts": []}')
    await findExcerpts({ paperText: PAPER.pdf_text, question: QUESTION, history: HISTORY, missing: MISSING }, llm)
    expect(llm.chat).toHaveBeenCalledOnce()
    const messages = llm.chat.mock.calls[0][0]
    const fullText = JSON.stringify(messages)
    expect(fullText).toContain(QUESTION)
    expect(fullText).toContain(PAPER.pdf_text)
    expect(fullText).toContain(HISTORY[0].answer)
  })

  it('works with empty history', async () => {
    const llm = makeLLM('{"excerpts": ["novel algorithm"]}')
    const result = await findExcerpts({ paperText: PAPER.pdf_text, question: QUESTION, history: [], missing: MISSING }, llm)
    expect(result).toEqual(['novel algorithm'])
  })
})

// ── buildGuidance ─────────────────────────────────────────────────────────────

describe('buildGuidance', () => {
  const EXCERPTS = ['The algorithm achieves 95% accuracy', 'We used a dataset of 10,000 samples']

  it('returns guidance string from LLM', async () => {
    const llm = makeLLM('Piensa en qué métricas usaron para medir el rendimiento.')
    const result = await buildGuidance({ question: QUESTION, history: HISTORY, missing: MISSING, excerpts: EXCERPTS }, llm)
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('returns empty string as fallback when LLM fails', async () => {
    const llm = { chat: vi.fn().mockRejectedValue(new Error('API error')) }
    const result = await buildGuidance({ question: QUESTION, history: HISTORY, missing: MISSING, excerpts: EXCERPTS }, llm)
    expect(result).toBe('')
  })

  it('includes excerpts, missing and professor answer in the prompt', async () => {
    const llm = makeLLM('guidance text')
    await buildGuidance({ question: QUESTION, history: HISTORY, missing: MISSING, excerpts: EXCERPTS }, llm)
    const messages = llm.chat.mock.calls[0][0]
    const fullText = JSON.stringify(messages)
    expect(fullText).toContain(EXCERPTS[0])
    expect(fullText).toContain(MISSING)
    expect(fullText).toContain(HISTORY[0].answer)
  })

  it('instructs to explain without asking questions or revealing the answer', async () => {
    const llm = makeLLM('guidance text')
    await buildGuidance({ question: QUESTION, history: HISTORY, missing: MISSING, excerpts: EXCERPTS }, llm)
    const messages = llm.chat.mock.calls[0][0]
    const systemMsg = messages.find(m => m.role === 'system')?.content || ''
    expect(systemMsg.toLowerCase()).not.toContain('da la respuesta')
    expect(systemMsg.toLowerCase()).toContain('no debe ser una pregunta')
  })
})

// ── buildAnswer ───────────────────────────────────────────────────────────────

describe('buildAnswer', () => {
  const EXCERPTS = ['The algorithm achieves 95% accuracy']

  it('returns answer string from LLM', async () => {
    const llm = makeLLM('La principal contribución es un algoritmo que alcanza 95% de precisión.')
    const result = await buildAnswer({ question: QUESTION, history: HISTORY, missing: MISSING, excerpts: EXCERPTS }, llm)
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('returns empty string as fallback when LLM fails', async () => {
    const llm = { chat: vi.fn().mockRejectedValue(new Error('API error')) }
    const result = await buildAnswer({ question: QUESTION, history: HISTORY, missing: MISSING, excerpts: EXCERPTS }, llm)
    expect(result).toBe('')
  })

  it('includes question, professor answer and missing in the prompt', async () => {
    const llm = makeLLM('answer text')
    await buildAnswer({ question: QUESTION, history: HISTORY, missing: MISSING, excerpts: EXCERPTS }, llm)
    const messages = llm.chat.mock.calls[0][0]
    const fullText = JSON.stringify(messages)
    expect(fullText).toContain(QUESTION)
    expect(fullText).toContain(HISTORY[0].answer)
    expect(fullText).toContain(MISSING)
  })
})

// ── generateHint ──────────────────────────────────────────────────────────────

describe('generateHint', () => {
  const student = { id: 1, name: 'María' }
  const context = { paper: PAPER, history: HISTORY, missing: MISSING }

  it('exchangeCount=1 returns excerpts only, guidance and answer are null', async () => {
    const llm = makeLLM('{"excerpts": ["novel algorithm"]}')
    const result = await generateHint(student, { ...context, exchangeCount: 1 }, llm)
    expect(Array.isArray(result.excerpts)).toBe(true)
    expect(result.guidance).toBeNull()
    expect(result.answer).toBeNull()
  })

  it('exchangeCount=2 returns excerpts and guidance, answer is null', async () => {
    const llm = { chat: vi.fn()
      .mockResolvedValueOnce('{"excerpts": ["novel algorithm"]}')
      .mockResolvedValueOnce('Piensa en las métricas.')
    }
    const result = await generateHint(student, { ...context, exchangeCount: 2 }, llm)
    expect(Array.isArray(result.excerpts)).toBe(true)
    expect(typeof result.guidance).toBe('string')
    expect(result.guidance.length).toBeGreaterThan(0)
    expect(result.answer).toBeNull()
  })

  it('exchangeCount=3 returns excerpts and answer, guidance is null', async () => {
    const llm = { chat: vi.fn()
      .mockResolvedValueOnce('{"excerpts": ["novel algorithm"]}')
      .mockResolvedValueOnce('La respuesta completa es: novel algorithm con 95% de precisión.')
    }
    const result = await generateHint(student, { ...context, exchangeCount: 3 }, llm)
    expect(Array.isArray(result.excerpts)).toBe(true)
    expect(typeof result.answer).toBe('string')
    expect(result.answer.length).toBeGreaterThan(0)
    expect(result.guidance).toBeNull()
  })

  it('uses paper.pdf_text for excerpt search', async () => {
    const llm = makeLLM('{"excerpts": []}')
    await generateHint(student, { ...context, exchangeCount: 1 }, llm)
    const fullText = JSON.stringify(llm.chat.mock.calls[0][0])
    expect(fullText).toContain(PAPER.pdf_text)
  })

  it('falls back to abstract when pdf_text is missing', async () => {
    const paperNoText = { ...PAPER, pdf_text: null }
    const llm = makeLLM('{"excerpts": []}')
    await generateHint(student, { ...context, paper: paperNoText, exchangeCount: 1 }, llm)
    const fullText = JSON.stringify(llm.chat.mock.calls[0][0])
    expect(fullText).toContain(PAPER.abstract)
  })

  it('passes professor answers to all LLM calls', async () => {
    const llm = { chat: vi.fn()
      .mockResolvedValueOnce('{"excerpts": ["novel algorithm"]}')
      .mockResolvedValueOnce('guidance text')
    }
    await generateHint(student, { ...context, exchangeCount: 2 }, llm)
    // Both LLM calls should include the professor's answer
    llm.chat.mock.calls.forEach(([messages]) => {
      const fullText = JSON.stringify(messages)
      expect(fullText).toContain(HISTORY[0].answer)
    })
  })
})
