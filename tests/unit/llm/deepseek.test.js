import { describe, it, expect, vi } from 'vitest'
import { createDeepSeekProvider } from '../../../src/llm/providers/deepseek.js'

// ── fixtures ──────────────────────────────────────────────────────────────────

const PAPER = {
  title: 'Attention Is All You Need',
  authors: 'Vaswani et al.',
  abstract: 'We propose the Transformer.',
  pdf_text: 'Full paper text here...'
}

const VALID_QUIZ_JSON = JSON.stringify({
  questions: [
    { question: 'Q1?', options: ['A', 'B', 'C', 'D'], correct: 0, explanation: 'Because A.' },
    { question: 'Q2?', options: ['A', 'B', 'C', 'D'], correct: 1, explanation: 'Because B.' },
    { question: 'Q3?', options: ['A', 'B', 'C', 'D'], correct: 2, explanation: 'Because C.' },
    { question: 'Q4?', options: ['A', 'B', 'C', 'D'], correct: 3, explanation: 'Because D.' },
    { question: 'Q5?', options: ['A', 'B', 'C', 'D'], correct: 0, explanation: 'Because A.' }
  ]
})

async function* makeStream(chunks) {
  for (const text of chunks) {
    yield { choices: [{ delta: { content: text } }] }
  }
}

function makeStreamClient(chunks) {
  return { chat: { completions: { create: vi.fn().mockResolvedValue(makeStream(chunks)) } } }
}

function makeJsonClient(text) {
  return {
    chat: { completions: { create: vi.fn().mockResolvedValue({ choices: [{ message: { content: text } }] }) } }
  }
}

// ── streamSummary ─────────────────────────────────────────────────────────────

describe('DeepSeek provider — streamSummary', () => {
  it('calls chat.completions.create with deepseek-chat', async () => {
    const mockClient = makeStreamClient(['hello'])
    const provider = createDeepSeekProvider('test-key', null, mockClient)
    await provider.streamSummary(PAPER, vi.fn())

    const args = mockClient.chat.completions.create.mock.calls[0][0]
    expect(args.model).toBe('deepseek-chat')
  })

  it('enables streaming', async () => {
    const mockClient = makeStreamClient(['hello'])
    const provider = createDeepSeekProvider('test-key', null, mockClient)
    await provider.streamSummary(PAPER, vi.fn())

    const args = mockClient.chat.completions.create.mock.calls[0][0]
    expect(args.stream).toBe(true)
  })

  it('sets max_tokens to 8192', async () => {
    const mockClient = makeStreamClient(['hello'])
    const provider = createDeepSeekProvider('test-key', null, mockClient)
    await provider.streamSummary(PAPER, vi.fn())

    const args = mockClient.chat.completions.create.mock.calls[0][0]
    expect(args.max_tokens).toBe(8192)
  })

  it('does NOT add response_format (deepseek-reasoner compatibility)', async () => {
    const mockClient = makeStreamClient(['hello'])
    const provider = createDeepSeekProvider('test-key', null, mockClient)
    await provider.streamSummary(PAPER, vi.fn())

    const args = mockClient.chat.completions.create.mock.calls[0][0]
    expect(args.response_format).toBeUndefined()
  })

  it('includes the paper title in the prompt', async () => {
    const mockClient = makeStreamClient(['hello'])
    const provider = createDeepSeekProvider('test-key', null, mockClient)
    await provider.streamSummary(PAPER, vi.fn())

    const messages = mockClient.chat.completions.create.mock.calls[0][0].messages
    expect(messages.find(m => m.role === 'user')?.content).toContain(PAPER.title)
  })

  it('forwards each text chunk to the onChunk callback', async () => {
    const mockClient = makeStreamClient(['chunk1', 'chunk2', 'chunk3'])
    const onChunk = vi.fn()
    const provider = createDeepSeekProvider('test-key', null, mockClient)
    await provider.streamSummary(PAPER, onChunk)

    expect(onChunk).toHaveBeenCalledWith('chunk1')
    expect(onChunk).toHaveBeenCalledWith('chunk2')
    expect(onChunk).toHaveBeenCalledWith('chunk3')
  })

  it('skips empty delta chunks without calling onChunk', async () => {
    async function* mixedStream() {
      yield { choices: [{ delta: { content: 'real' } }] }
      yield { choices: [{ delta: {} }] }
      yield { choices: [{ delta: { content: '' } }] }
    }
    const mockClient = { chat: { completions: { create: vi.fn().mockResolvedValue(mixedStream()) } } }
    const onChunk = vi.fn()
    const provider = createDeepSeekProvider('test-key', null, mockClient)
    await provider.streamSummary(PAPER, onChunk)

    expect(onChunk).toHaveBeenCalledTimes(1)
    expect(onChunk).toHaveBeenCalledWith('real')
  })

  it('returns the full concatenated text', async () => {
    const mockClient = makeStreamClient(['Hello ', 'world'])
    const provider = createDeepSeekProvider('test-key', null, mockClient)
    const result = await provider.streamSummary(PAPER, vi.fn())
    expect(result).toBe('Hello world')
  })
})

// ── generateQuiz ──────────────────────────────────────────────────────────────

describe('DeepSeek provider — generateQuiz', () => {
  it('calls chat.completions.create with deepseek-chat', async () => {
    const mockClient = makeJsonClient(VALID_QUIZ_JSON)
    const provider = createDeepSeekProvider('test-key', null, mockClient)
    await provider.generateQuiz(PAPER)

    const args = mockClient.chat.completions.create.mock.calls[0][0]
    expect(args.model).toBe('deepseek-chat')
  })

  it('includes the paper title in the prompt', async () => {
    const mockClient = makeJsonClient(VALID_QUIZ_JSON)
    const provider = createDeepSeekProvider('test-key', null, mockClient)
    await provider.generateQuiz(PAPER)

    const messages = mockClient.chat.completions.create.mock.calls[0][0].messages
    expect(messages.find(m => m.role === 'user')?.content).toContain(PAPER.title)
  })

  it('returns parsed questions array with 5 items', async () => {
    const mockClient = makeJsonClient(VALID_QUIZ_JSON)
    const provider = createDeepSeekProvider('test-key', null, mockClient)
    const result = await provider.generateQuiz(PAPER)
    expect(result.questions).toHaveLength(5)
  })

  it('each question has question, options, correct, explanation', async () => {
    const mockClient = makeJsonClient(VALID_QUIZ_JSON)
    const provider = createDeepSeekProvider('test-key', null, mockClient)
    const result = await provider.generateQuiz(PAPER)
    for (const q of result.questions) {
      expect(q).toHaveProperty('question')
      expect(q).toHaveProperty('options')
      expect(q).toHaveProperty('correct')
      expect(q).toHaveProperty('explanation')
      expect(q.options).toHaveLength(4)
    }
  })

  it('throws when the response JSON is malformed', async () => {
    const mockClient = makeJsonClient('not json at all')
    const provider = createDeepSeekProvider('test-key', null, mockClient)
    await expect(provider.generateQuiz(PAPER)).rejects.toThrow()
  })

  it('handles JSON wrapped in markdown code fences', async () => {
    const fenced = `\`\`\`json\n${VALID_QUIZ_JSON}\n\`\`\``
    const mockClient = makeJsonClient(fenced)
    const provider = createDeepSeekProvider('test-key', null, mockClient)
    const result = await provider.generateQuiz(PAPER)
    expect(result.questions).toHaveLength(5)
  })
})

// ── factory — createLLM ───────────────────────────────────────────────────────

describe('createLLM factory', async () => {
  const { createLLM } = await import('../../../src/llm/index.js')

  it('returns openai provider by default', () => {
    const llm = createLLM({ apiKey: 'test', llmProvider: 'openai' })
    expect(typeof llm.streamSummary).toBe('function')
    expect(typeof llm.generateQuiz).toBe('function')
    expect(typeof llm.extractAffiliationsWithAI).toBe('function')
    expect(typeof llm.extractPaperMetadata).toBe('function')
  })

  it('returns anthropic provider when llmProvider is anthropic', () => {
    const llm = createLLM({ apiKey: 'test', llmProvider: 'anthropic' })
    expect(typeof llm.streamSummary).toBe('function')
  })

  it('returns deepseek provider when llmProvider is deepseek', () => {
    const llm = createLLM({ apiKey: 'test', llmProvider: 'deepseek' })
    expect(typeof llm.streamSummary).toBe('function')
  })

  it('defaults to openai when llmProvider is undefined', () => {
    const llm = createLLM({ apiKey: 'test' })
    expect(typeof llm.streamSummary).toBe('function')
  })
})