import { describe, it, expect, vi } from 'vitest'
import { chatWithPaper } from '../../../src/chat/index.js'

const PAPER = {
  id: '2401.00001',
  title: 'Attention Is All You Need',
  authors: 'Vaswani et al.',
  abstract: 'We propose the Transformer architecture.',
  pdf_text: 'Full paper text with methodology details...'
}

function makeLLM(responseText) {
  return { chat: vi.fn().mockResolvedValue(responseText) }
}

// ── structure ─────────────────────────────────────────────────────────────────

describe('chatWithPaper', () => {
  it('includes paper title and text in the system message', async () => {
    const llm = makeLLM('answer')
    await chatWithPaper('pregunta', PAPER, [], llm)
    const messages = llm.chat.mock.calls[0][0]
    const system = messages.find(m => m.role === 'system')
    expect(system).toBeDefined()
    expect(system.content).toContain(PAPER.title)
    expect(system.content).toContain(PAPER.pdf_text)
  })

  it('includes the user message as the last message', async () => {
    const llm = makeLLM('answer')
    await chatWithPaper('mi pregunta', PAPER, [], llm)
    const messages = llm.chat.mock.calls[0][0]
    const last = messages[messages.length - 1]
    expect(last.role).toBe('user')
    expect(last.content).toBe('mi pregunta')
  })

  it('includes conversation history before the new user message', async () => {
    const llm = makeLLM('answer')
    const history = [
      { role: 'user',      content: 'pregunta anterior' },
      { role: 'assistant', content: 'respuesta anterior' }
    ]
    await chatWithPaper('nueva pregunta', PAPER, history, llm)
    const messages = llm.chat.mock.calls[0][0]
    const userMessages = messages.filter(m => m.role === 'user')
    expect(userMessages).toHaveLength(2)
    expect(userMessages[0].content).toBe('pregunta anterior')
    expect(userMessages[1].content).toBe('nueva pregunta')
  })

  it('returns the assistant response text', async () => {
    const llm = makeLLM('La idea principal es...')
    const result = await chatWithPaper('¿Cuál es la idea?', PAPER, [], llm)
    expect(result).toBe('La idea principal es...')
  })

  it('works without a paper — uses generic assistant context', async () => {
    const llm = makeLLM('No tengo contexto específico.')
    const result = await chatWithPaper('hola', null, [], llm)
    const messages = llm.chat.mock.calls[0][0]
    const system = messages.find(m => m.role === 'system')
    expect(system).toBeDefined()
    expect(result).toBe('No tengo contexto específico.')
  })

  it('uses abstract as fallback when pdf_text is missing', async () => {
    const llm = makeLLM('answer')
    const paperNoText = { ...PAPER, pdf_text: null }
    await chatWithPaper('pregunta', paperNoText, [], llm)
    const messages = llm.chat.mock.calls[0][0]
    const system = messages.find(m => m.role === 'system')
    expect(system.content).toContain(PAPER.abstract)
  })
})