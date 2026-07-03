import { describe, it, expect, vi } from 'vitest'
import { createOpenAIProvider } from '../../../src/llm/providers/openai.js'

// ─── fixtures ─────────────────────────────────────────────────────────────────

const PAPER = {
  title: 'Attention Is All You Need',
  authors: 'Vaswani et al.',
  abstract: 'We propose the Transformer.',
  pdf_text: 'Full paper text here...'
}

const VALID_QUIZ_JSON = JSON.stringify({
  questions: Array.from({ length: 5 }, (_, i) => ({
    question: `Q${i + 1}?`,
    options: ['A', 'B', 'C', 'D'],
    correct: 0,
    explanation: 'Because A.'
  }))
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

// ─── streamSummary ────────────────────────────────────────────────────────────

describe('OpenAI provider — streamSummary', () => {
  it('uses gpt-4o model by default', async () => {
    const mockClient = makeStreamClient(['hello'])
    const provider = createOpenAIProvider('sk-test', null, mockClient)
    await provider.streamSummary(PAPER, vi.fn())

    expect(mockClient.chat.completions.create.mock.calls[0][0].model).toBe('gpt-4o')
  })

  it('enables streaming', async () => {
    const mockClient = makeStreamClient(['hello'])
    const provider = createOpenAIProvider('sk-test', null, mockClient)
    await provider.streamSummary(PAPER, vi.fn())

    expect(mockClient.chat.completions.create.mock.calls[0][0].stream).toBe(true)
  })

  it('forwards each text chunk to the onChunk callback', async () => {
    const mockClient = makeStreamClient(['chunk1', 'chunk2', 'chunk3'])
    const onChunk = vi.fn()
    const provider = createOpenAIProvider('sk-test', null, mockClient)
    await provider.streamSummary(PAPER, onChunk)

    expect(onChunk).toHaveBeenCalledWith('chunk1')
    expect(onChunk).toHaveBeenCalledWith('chunk2')
    expect(onChunk).toHaveBeenCalledWith('chunk3')
  })

  it('skips empty delta chunks without calling onChunk', async () => {
    async function* mixed() {
      yield { choices: [{ delta: { content: 'real' } }] }
      yield { choices: [{ delta: {} }] }
      yield { choices: [{ delta: { content: '' } }] }
    }
    const mockClient = { chat: { completions: { create: vi.fn().mockResolvedValue(mixed()) } } }
    const onChunk = vi.fn()
    await createOpenAIProvider('sk-test', null, mockClient).streamSummary(PAPER, onChunk)
    expect(onChunk).toHaveBeenCalledTimes(1)
  })

  it('returns the full concatenated text', async () => {
    const mockClient = makeStreamClient(['Hello ', 'world'])
    const result = await createOpenAIProvider('sk-test', null, mockClient).streamSummary(PAPER, vi.fn())
    expect(result).toBe('Hello world')
  })

  it('includes paper title in the prompt', async () => {
    const mockClient = makeStreamClient(['x'])
    await createOpenAIProvider('sk-test', null, mockClient).streamSummary(PAPER, vi.fn())
    const messages = mockClient.chat.completions.create.mock.calls[0][0].messages
    expect(messages.find(m => m.role === 'user')?.content).toContain(PAPER.title)
  })
})

// ─── generateQuiz ─────────────────────────────────────────────────────────────

describe('OpenAI provider — generateQuiz', () => {
  it('requests JSON object response format', async () => {
    const mockClient = makeJsonClient(VALID_QUIZ_JSON)
    await createOpenAIProvider('sk-test', null, mockClient).generateQuiz(PAPER)
    const args = mockClient.chat.completions.create.mock.calls[0][0]
    expect(args.response_format).toEqual({ type: 'json_object' })
  })

  it('returns parsed quiz with 5 questions', async () => {
    const mockClient = makeJsonClient(VALID_QUIZ_JSON)
    const result = await createOpenAIProvider('sk-test', null, mockClient).generateQuiz(PAPER)
    expect(result.questions).toHaveLength(5)
  })

  it('each question has 4 options', async () => {
    const mockClient = makeJsonClient(VALID_QUIZ_JSON)
    const result = await createOpenAIProvider('sk-test', null, mockClient).generateQuiz(PAPER)
    for (const q of result.questions) {
      expect(q.options).toHaveLength(4)
    }
  })

  it('handles JSON wrapped in markdown fences', async () => {
    const fenced = `\`\`\`json\n${VALID_QUIZ_JSON}\n\`\`\``
    const mockClient = makeJsonClient(fenced)
    const result = await createOpenAIProvider('sk-test', null, mockClient).generateQuiz(PAPER)
    expect(result.questions).toHaveLength(5)
  })

  it('throws when response JSON is malformed', async () => {
    const mockClient = makeJsonClient('not json')
    await expect(createOpenAIProvider('sk-test', null, mockClient).generateQuiz(PAPER)).rejects.toThrow()
  })
})

// ─── extractAffiliationsWithAI ────────────────────────────────────────────────

describe('OpenAI provider — extractAffiliationsWithAI', () => {
  it('returns an array of affiliation strings', async () => {
    const mockClient = makeJsonClient(JSON.stringify(['MIT', 'Stanford']))
    const result = await createOpenAIProvider('sk-test', null, mockClient).extractAffiliationsWithAI('page text')
    expect(result).toEqual(['MIT', 'Stanford'])
  })

  it('returns null when the response is not an array', async () => {
    const mockClient = makeJsonClient(JSON.stringify({ affiliations: ['MIT'] }))
    const result = await createOpenAIProvider('sk-test', null, mockClient).extractAffiliationsWithAI('page text')
    expect(result).toBeNull()
  })

  it('returns null when the API call throws', async () => {
    const mockClient = {
      chat: { completions: { create: vi.fn().mockRejectedValue(new Error('API error')) } }
    }
    const result = await createOpenAIProvider('sk-test', null, mockClient).extractAffiliationsWithAI('text')
    expect(result).toBeNull()
  })
})

// ─── extractPaperMetadata ─────────────────────────────────────────────────────

describe('OpenAI provider — extractPaperMetadata', () => {
  it('returns title, authors and abstract from the response', async () => {
    const meta = { title: 'My Paper', authors: 'Alice, Bob', abstract: 'We study...' }
    const mockClient = makeJsonClient(JSON.stringify(meta))
    const result = await createOpenAIProvider('sk-test', null, mockClient).extractPaperMetadata('page text')
    expect(result).toMatchObject(meta)
  })

  it('returns empty strings when the API call throws', async () => {
    const mockClient = {
      chat: { completions: { create: vi.fn().mockRejectedValue(new Error('timeout')) } }
    }
    const result = await createOpenAIProvider('sk-test', null, mockClient).extractPaperMetadata('text')
    expect(result).toEqual({ title: '', authors: '', abstract: '' })
  })
})

// ─── summarizeAbstract ────────────────────────────────────────────────────────

describe('OpenAI provider — summarizeAbstract', () => {
  it('returns the trimmed summary text', async () => {
    const mockClient = makeJsonClient('  A short summary.  ')
    const result = await createOpenAIProvider('sk-test', null, mockClient).summarizeAbstract('We study diffusion models.')
    expect(result).toBe('A short summary.')
  })

  it('includes the abstract text in the prompt', async () => {
    const mockClient = makeJsonClient('summary')
    await createOpenAIProvider('sk-test', null, mockClient).summarizeAbstract('Unique abstract content XYZ')
    const args = mockClient.chat.completions.create.mock.calls[0][0]
    expect(args.messages[0].content).toContain('Unique abstract content XYZ')
  })

  it('falls back to a truncated abstract when the API call throws', async () => {
    const mockClient = {
      chat: { completions: { create: vi.fn().mockRejectedValue(new Error('timeout')) } }
    }
    const longAbstract = 'y'.repeat(500)
    const result = await createOpenAIProvider('sk-test', null, mockClient).summarizeAbstract(longAbstract)
    expect(result).toBe(longAbstract.slice(0, 200))
  })
})

// ─── chat ─────────────────────────────────────────────────────────────────────

describe('OpenAI provider — chat', () => {
  it('passes messages directly to the API', async () => {
    const messages = [
      { role: 'system', content: 'You are helpful' },
      { role: 'user',   content: 'Hello' },
    ]
    const mockClient = makeJsonClient('Hi there!')
    await createOpenAIProvider('sk-test', null, mockClient).chat(messages)
    const args = mockClient.chat.completions.create.mock.calls[0][0]
    expect(args.messages).toEqual(messages)
  })

  it('returns the assistant response text', async () => {
    const mockClient = makeJsonClient('La respuesta es 42.')
    const result = await createOpenAIProvider('sk-test', null, mockClient).chat([
      { role: 'user', content: '¿La respuesta?' }
    ])
    expect(result).toBe('La respuesta es 42.')
  })
})
