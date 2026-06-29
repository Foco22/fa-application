import { describe, it, expect, vi } from 'vitest'
import { generateTurn, evaluateAndReact, evaluatePresentation } from '../../../src/class/students.js'

const PAPER = {
  id: '2401.00001',
  title: 'Attention Is All You Need',
  authors: 'Vaswani et al.',
  abstract: 'We propose the Transformer architecture based solely on attention mechanisms.',
  pdf_text: 'The Transformer model achieves 28.4 BLEU on WMT 2014 English-to-German translation.',
}

const SLIDES = []

const STUDENT_MARIA = { id: 1 }

function makeLLM(response) {
  return { chat: vi.fn().mockResolvedValue(response) }
}

// ── generateTurn ──────────────────────────────────────────────────────────────

describe('generateTurn', () => {
  it('returns the question from the LLM', async () => {
    const llm = makeLLM('Hola profesor, ¿qué métricas usaron para evaluar el modelo?')
    const result = await generateTurn(
      { id: 1, name: 'María', role: 'estudiante', trait: 'curiosa', systemPrompt: () => 'system' },
      { paper: PAPER, slides: SLIDES, history: [], previousQA: [] },
      llm
    )
    expect(result).toBe('Hola profesor, ¿qué métricas usaron para evaluar el modelo?')
  })

  it('trims whitespace from the response', async () => {
    const llm = makeLLM('  ¿Cómo funciona el attention?  \n')
    const result = await generateTurn(
      { id: 1, name: 'María', role: 'estudiante', trait: '', systemPrompt: () => 'system' },
      { paper: PAPER, slides: SLIDES, history: [], previousQA: [] },
      llm
    )
    expect(result).toBe('¿Cómo funciona el attention?')
  })

  it('throws when LLM returns empty string', async () => {
    const llm = makeLLM('')
    await expect(
      generateTurn(
        { id: 1, name: 'María', role: 'estudiante', trait: '', systemPrompt: () => 'system' },
        { paper: PAPER, slides: SLIDES, history: [], previousQA: [] },
        llm
      )
    ).rejects.toThrow('LLM returned empty response')
  })

  it('throws when LLM returns null (reasoning model with empty content)', async () => {
    const llm = makeLLM(null)
    await expect(
      generateTurn(
        { id: 1, name: 'María', role: 'estudiante', trait: '', systemPrompt: () => 'system' },
        { paper: PAPER, slides: SLIDES, history: [], previousQA: [] },
        llm
      )
    ).rejects.toThrow('LLM returned empty response')
  })

  it('throws when LLM returns only whitespace', async () => {
    const llm = makeLLM('   \n  ')
    await expect(
      generateTurn(
        { id: 1, name: 'María', role: 'estudiante', trait: '', systemPrompt: () => 'system' },
        { paper: PAPER, slides: SLIDES, history: [], previousQA: [] },
        llm
      )
    ).rejects.toThrow('LLM returned empty response')
  })

  it('throws when LLM call itself rejects', async () => {
    const llm = { chat: vi.fn().mockRejectedValue(new Error('API error 400')) }
    await expect(
      generateTurn(
        { id: 1, name: 'María', role: 'estudiante', trait: '', systemPrompt: () => 'system' },
        { paper: PAPER, slides: SLIDES, history: [], previousQA: [] },
        llm
      )
    ).rejects.toThrow('API error 400')
  })

  it('sends system prompt from student.systemPrompt()', async () => {
    const systemPrompt = vi.fn().mockReturnValue('SYSTEM CONTENT')
    const llm = makeLLM('pregunta válida')
    await generateTurn(
      { id: 1, name: 'María', role: 'estudiante', trait: '', systemPrompt },
      { paper: PAPER, slides: SLIDES, history: [], previousQA: [] },
      llm
    )
    expect(systemPrompt).toHaveBeenCalledWith(PAPER, SLIDES)
    const messages = llm.chat.mock.calls[0][0]
    expect(messages[0]).toEqual({ role: 'system', content: 'SYSTEM CONTENT' })
  })

  it('includes previousQA context when other students already asked', async () => {
    const llm = makeLLM('¿Qué limitaciones tiene el modelo?')
    await generateTurn(
      { id: 2, name: 'Carlos', role: 'ingeniero', trait: '', systemPrompt: () => 'system' },
      {
        paper: PAPER, slides: SLIDES, history: [],
        previousQA: [{ studentName: 'María', question: '¿Cómo funciona el attention?' }]
      },
      llm
    )
    const messages = llm.chat.mock.calls[0][0]
    const fullText = JSON.stringify(messages)
    expect(fullText).toContain('María')
    expect(fullText).toContain('¿Cómo funciona el attention?')
  })

  it('includes conversation history for follow-up questions', async () => {
    const history = [{ question: '¿Cómo funciona?', answer: 'Con attention.' }]
    const llm = makeLLM('¿Pero cómo exactamente?')
    await generateTurn(
      { id: 1, name: 'María', role: 'estudiante', trait: '', systemPrompt: () => 'system' },
      { paper: PAPER, slides: SLIDES, history, previousQA: [] },
      llm
    )
    const messages = llm.chat.mock.calls[0][0]
    const assistantMsg = messages.find(m => m.role === 'assistant')
    expect(assistantMsg?.content).toBe('¿Cómo funciona?')
    const userAnswerMsg = messages.find(m => m.role === 'user' && m.content === 'Con attention.')
    expect(userAnswerMsg).toBeDefined()
  })
})

// ── evaluatePresentation ──────────────────────────────────────────────────────

describe('evaluatePresentation', () => {
  it('returns score, feedback, strengths and improvements from LLM', async () => {
    const llm = makeLLM(JSON.stringify({
      score: 85,
      feedback: 'Buena explicación del mecanismo de atención.',
      strengths: 'Claridad conceptual.',
      improvements: 'Faltó mencionar complejidad computacional.'
    }))
    const result = await evaluatePresentation({ paper: PAPER, transcript: 'Hoy presentaré el Transformer...' }, llm)
    expect(result.score).toBe(85)
    expect(result.feedback).toContain('atención')
    expect(result.strengths).toBeTruthy()
    expect(result.improvements).toBeTruthy()
  })

  it('returns score 0 fallback when LLM throws', async () => {
    const llm = { chat: vi.fn().mockRejectedValue(new Error('API down')) }
    const result = await evaluatePresentation({ paper: PAPER, transcript: 'algo' }, llm)
    expect(result.score).toBe(0)
    expect(result.feedback).toBeTruthy()
  })

  it('handles JSON wrapped in markdown fences', async () => {
    const llm = makeLLM('```json\n{"score":70,"feedback":"OK","strengths":"","improvements":""}\n```')
    const result = await evaluatePresentation({ paper: PAPER, transcript: 'presentación' }, llm)
    expect(result.score).toBe(70)
  })
})
