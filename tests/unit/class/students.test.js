import { describe, it, expect, vi } from 'vitest'
import { generateTurn, evaluateAndReact, evaluatePresentation, isNonAnswer, generateReferenceAnswer } from '../../../src/class/students.js'

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

// ── evaluateAndReact ─────────────────────────────────────────────────────────
// Un evaluador LLM (no la persona del estudiante) compara la pregunta, las
// respuestas del profesor y la respuesta correcta según el paper, y decide si
// pasa. El turno no avanza por cansancio, por un error, ni por un "no sé".

const STUDENT = { id: 2, name: 'Carlos', systemPrompt: () => 'system' }
const QUESTION = '¿Por qué el GRU no tiene output gate?'
const REFERENCE = 'Porque el GRU expone todo su estado oculto; la reset gate controla cuánto del estado previo entra al candidato.'
const HISTORY = (answer) => [{ question: QUESTION, answer }]
const ctx = (answer, extra = {}) => ({ paper: PAPER, slides: SLIDES, history: HISTORY(answer), referenceAnswer: REFERENCE, exchangeCount: 1, ...extra })

// 1ª llamada = evaluador (JSON), 2ª = reacción del estudiante (texto)
function makeSeqLLM(...responses) {
  const chat = vi.fn()
  responses.forEach(r => r instanceof Error ? chat.mockRejectedValueOnce(r) : chat.mockResolvedValueOnce(r))
  return { chat }
}
const promptOf = (llm, call) => llm.chat.mock.calls[call][0].map(m => m.content).join('\n')

describe('evaluateAndReact', () => {
  it('passes when the evaluator says the answer covers the reference answer', async () => {
    const llm = makeSeqLLM('{"passed": true, "missing": null}', '¡Ahora sí lo entiendo, gracias!')
    const r = await evaluateAndReact(STUDENT, ctx('Porque expone todo el estado y la reset gate ya filtra el pasado.'), llm)
    expect(r.satisfied).toBe(true)
    expect(r.reaction).toBe('¡Ahora sí lo entiendo, gracias!')
    expect(r.missing).toBeNull()
  })

  it('gives the evaluator the question, the professor answer and the reference answer', async () => {
    const llm = makeSeqLLM('{"passed": false, "missing": "el rol de la reset gate"}', 'Hmm, ¿y la reset gate?')
    await evaluateAndReact(STUDENT, ctx('es por eficiencia'), llm)
    const judge = promptOf(llm, 0)
    expect(judge).toContain(QUESTION)
    expect(judge).toContain('es por eficiencia')
    expect(judge).toContain(REFERENCE)
  })

  it('does not pass and reports what is missing when the evaluator says so', async () => {
    const llm = makeSeqLLM('{"passed": false, "missing": "el rol de la reset gate"}', 'Hmm, ¿y la reset gate qué hace?')
    const r = await evaluateAndReact(STUDENT, ctx('es por eficiencia'), llm)
    expect(r.satisfied).toBe(false)
    expect(r.missing).toBe('el rol de la reset gate')
    expect(promptOf(llm, 1)).toContain('el rol de la reset gate')
  })

  it('treats passed:"false" (string) as NOT passed', async () => {
    const llm = makeSeqLLM('{"passed": "false", "missing": "x"}', 'Hmm')
    const r = await evaluateAndReact(STUDENT, ctx('algo del gate'), llm)
    expect(r.satisfied).toBe(false)
  })

  it('judges all the professor answers of the turn together (later answers can complete earlier ones)', async () => {
    const llm = makeSeqLLM('{"passed": true, "missing": null}', 'Gracias')
    const history = [
      { question: QUESTION, answer: 'expone todo el estado oculto' },
      { question: '¿Y qué pasa con el estado previo?', answer: 'la reset gate decide cuánto entra' },
    ]
    await evaluateAndReact(STUDENT, ctx(null, { history }), llm)
    const judge = promptOf(llm, 0)
    expect(judge).toContain('expone todo el estado oculto')
    expect(judge).toContain('la reset gate decide cuánto entra')
  })

  it.each(['no sé', 'No lo sé.', 'hola', 'Hola Carlos', 'ok', 'mmm', ''])(
    'never passes a non-answer (%j) and does not even ask the evaluator', async (answer) => {
      const llm = makeSeqLLM('{"passed": true, "missing": null}', 'Gracias')
      const r = await evaluateAndReact(STUDENT, ctx(answer), llm)
      expect(r.satisfied).toBe(false)
      expect(r.missing).toBeTruthy()
      expect(llm.chat).not.toHaveBeenCalled()
    })

  it('does not force a pass after many exchanges', async () => {
    const llm = makeSeqLLM('{"passed": false, "missing": "la reset gate"}', 'Sigo sin entender')
    const r = await evaluateAndReact(STUDENT, ctx('es por eficiencia', { exchangeCount: 9 }), llm)
    expect(r.satisfied).toBe(false)
  })

  it('does NOT pass when the evaluator fails', async () => {
    const llm = makeSeqLLM(new Error('timeout'))
    const r = await evaluateAndReact(STUDENT, ctx('Porque la reset gate ya filtra.'), llm)
    expect(r.satisfied).toBe(false)
  })

  it('keeps the verdict with a fallback reaction when only the reaction call fails', async () => {
    const llm = makeSeqLLM('{"passed": true, "missing": null}', new Error('timeout'))
    const r = await evaluateAndReact(STUDENT, ctx('Porque expone todo el estado y la reset gate filtra.'), llm)
    expect(r.satisfied).toBe(true)
    expect(r.reaction).toBeTruthy()
  })
})

describe('generateReferenceAnswer', () => {
  it('asks for the correct answer to the question grounded in the paper text', async () => {
    const llm = makeLLM('  ' + REFERENCE + '  ')
    const ref = await generateReferenceAnswer(PAPER, QUESTION, llm)
    expect(ref).toBe(REFERENCE)
    const prompt = llm.chat.mock.calls[0][0].map(m => m.content).join('\n')
    expect(prompt).toContain(QUESTION)
    expect(prompt).toContain(PAPER.pdf_text)
  })

  it('returns null when the LLM fails (the evaluator then judges against the paper itself)', async () => {
    const llm = { chat: vi.fn().mockRejectedValue(new Error('x')) }
    expect(await generateReferenceAnswer(PAPER, QUESTION, llm)).toBeNull()
  })
})

describe('isNonAnswer', () => {
  it.each(['no sé', 'No lo sé', 'ni idea', 'hola', 'Hola profesor', 'Buenas tardes', 'ok', 'mmm...', 'no tengo idea, la verdad', "I don't know", ''])(
    'flags %j as a non-answer', (t) => expect(isNonAnswer(t)).toBe(true))

  it.each(['Usan BLEU', 'No, el GRU no tiene output gate', 'no sé bien, pero creo que la reset gate controla cuánto del estado previo se usa'])(
    'accepts %j as an attempt', (t) => expect(isNonAnswer(t)).toBe(false))
})
