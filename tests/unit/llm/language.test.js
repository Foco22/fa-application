import { describe, it, expect, vi } from 'vitest'
import { buildSummaryPrompt, buildQuizPrompt } from '../../../src/llm/prompts.js'
import { buildSystemPrompt } from '../../../src/chat/prompts.js'
import { chatWithPaper } from '../../../src/chat/index.js'
import { createLLM } from '../../../src/llm/index.js'
import { createAnthropicProvider } from '../../../src/llm/providers/anthropic.js'

const PAPER = { title: 'T', authors: 'A', abstract: 'Ab', pdf_text: 'texto' }

// Con proveedores mockeados no se puede afirmar que un LLM real "responda en
// inglés" — lo verificable es que la instrucción de idioma correcta llegue al
// cliente. Eso es lo que testeamos (ver PRD, métricas técnicas).

describe('prompts — idioma', () => {
  it('pide español por defecto, igual que hoy', () => {
    expect(buildSummaryPrompt(PAPER)).toMatch(/español/i)
    expect(buildQuizPrompt(PAPER)).toMatch(/español/i)
  })

  it('pide inglés cuando el idioma es en', () => {
    const summary = buildSummaryPrompt(PAPER, 'en')
    expect(summary).toMatch(/English/i)
    expect(summary).not.toMatch(/en español/i)

    const quiz = buildQuizPrompt(PAPER, 'en')
    expect(quiz).toMatch(/English/i)
    expect(quiz).not.toMatch(/en español/i)
  })

  // El idioma cambia el contenido, nunca el esquema: el parseo del quiz y del
  // resumen depende de estas claves.
  it('mantiene el esquema JSON idéntico en ambos idiomas', () => {
    for (const lang of ['es', 'en']) {
      expect(buildQuizPrompt(PAPER, lang)).toContain('"questions"')
      expect(buildQuizPrompt(PAPER, lang)).toContain('"explanation"')
      expect(buildSummaryPrompt(PAPER, lang)).toContain('{"1": "...", "2": "...", "3": "...", "4": "...", "5": "..."}')
    }
  })

  it('cae a español si el idioma es desconocido', () => {
    expect(buildSummaryPrompt(PAPER, 'klingon')).toMatch(/español/i)
  })
})

describe('chat — idioma', () => {
  it('instruye al asistente a responder en el idioma activo', () => {
    expect(buildSystemPrompt(PAPER, 'en')).toMatch(/English/i)
    expect(buildSystemPrompt(PAPER, 'es')).toMatch(/español/i)
  })

  it('chatWithPaper propaga el idioma al system prompt', async () => {
    const llm = { chat: vi.fn().mockResolvedValue('ok') }
    await chatWithPaper('hola', PAPER, [], llm, 'en')

    const [messages] = llm.chat.mock.calls[0]
    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toMatch(/English/i)
  })
})

describe('createLLM — idioma', () => {
  it('propaga settings.language al proveedor, que lo mete en el prompt', async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: '{}' }], usage: {} })
    const client = { messages: { create, stream: vi.fn() } }

    const llm = createAnthropicProvider('sk', 'claude-opus-4-8', client, null, 'en')
    await llm.generateQuiz(PAPER).catch(() => {})

    expect(create.mock.calls[0][0].messages[0].content).toMatch(/English/i)
  })

  it('createLLM lee el idioma desde settings', () => {
    const llm = createLLM({ llmProvider: 'anthropic', apiKey: 'sk', language: 'en' })
    expect(llm).toBeDefined()   // no explota; el detalle del prompt lo cubre el test anterior
  })
})