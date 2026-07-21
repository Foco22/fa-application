import { describe, it, expect, vi } from 'vitest'
import { createAnthropicProvider } from '../../../src/llm/providers/anthropic.js'

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

// ─── Anthropic client mock factories ─────────────────────────────────────────

function textBlock(text) {
  return { type: 'text', text }
}

function makeStreamClient(chunks) {
  async function* textStream() {
    for (const c of chunks) yield c
  }
  return {
    messages: {
      stream: vi.fn().mockReturnValue({ textStream: textStream() }),
      create: vi.fn(),
    }
  }
}

function makeCreateClient(text) {
  return {
    messages: {
      stream: vi.fn(),
      create: vi.fn().mockResolvedValue({ content: [textBlock(text)] }),
    }
  }
}

// ─── streamSummary ────────────────────────────────────────────────────────────

describe('Anthropic provider — streamSummary', () => {
  it('calls messages.stream (not create)', async () => {
    const mockClient = makeStreamClient(['hello'])
    const provider = createAnthropicProvider('sk-test', null, mockClient)
    await provider.streamSummary(PAPER, vi.fn())
    expect(mockClient.messages.stream).toHaveBeenCalledOnce()
  })

  it('uses claude-opus-4-8 by default', async () => {
    const mockClient = makeStreamClient(['hello'])
    const provider = createAnthropicProvider('sk-test', null, mockClient)
    await provider.streamSummary(PAPER, vi.fn())
    const args = mockClient.messages.stream.mock.calls[0][0]
    expect(args.model).toBe('claude-opus-4-8')
  })

  it('uses adaptive thinking', async () => {
    const mockClient = makeStreamClient(['hello'])
    await createAnthropicProvider('sk-test', null, mockClient).streamSummary(PAPER, vi.fn())
    const args = mockClient.messages.stream.mock.calls[0][0]
    expect(args.thinking).toEqual({ type: 'adaptive' })
  })

  it('forwards each chunk to the onChunk callback', async () => {
    const mockClient = makeStreamClient(['chunk1', 'chunk2'])
    const onChunk = vi.fn()
    await createAnthropicProvider('sk-test', null, mockClient).streamSummary(PAPER, onChunk)
    expect(onChunk).toHaveBeenCalledWith('chunk1')
    expect(onChunk).toHaveBeenCalledWith('chunk2')
  })

  it('returns the full concatenated text', async () => {
    const mockClient = makeStreamClient(['Hello ', 'world'])
    const result = await createAnthropicProvider('sk-test', null, mockClient).streamSummary(PAPER, vi.fn())
    expect(result).toBe('Hello world')
  })

  it('includes paper title in the prompt', async () => {
    const mockClient = makeStreamClient(['x'])
    await createAnthropicProvider('sk-test', null, mockClient).streamSummary(PAPER, vi.fn())
    const args = mockClient.messages.stream.mock.calls[0][0]
    const userMsg = args.messages.find(m => m.role === 'user')
    expect(userMsg?.content).toContain(PAPER.title)
  })
})

// ─── generateQuiz ─────────────────────────────────────────────────────────────

describe('Anthropic provider — generateQuiz', () => {
  it('calls messages.create', async () => {
    const mockClient = makeCreateClient(VALID_QUIZ_JSON)
    await createAnthropicProvider('sk-test', null, mockClient).generateQuiz(PAPER)
    expect(mockClient.messages.create).toHaveBeenCalledOnce()
  })

  it('returns parsed quiz with 5 questions', async () => {
    const mockClient = makeCreateClient(VALID_QUIZ_JSON)
    const result = await createAnthropicProvider('sk-test', null, mockClient).generateQuiz(PAPER)
    expect(result.questions).toHaveLength(5)
  })

  it('handles JSON wrapped in markdown fences', async () => {
    const fenced = `\`\`\`json\n${VALID_QUIZ_JSON}\n\`\`\``
    const mockClient = makeCreateClient(fenced)
    const result = await createAnthropicProvider('sk-test', null, mockClient).generateQuiz(PAPER)
    expect(result.questions).toHaveLength(5)
  })
})

// ─── extractAffiliationsWithAI ────────────────────────────────────────────────

describe('Anthropic provider — extractAffiliationsWithAI', () => {
  it('returns an array of affiliation strings', async () => {
    const mockClient = makeCreateClient(JSON.stringify(['MIT', 'Harvard']))
    const result = await createAnthropicProvider('sk-test', null, mockClient).extractAffiliationsWithAI('page text')
    expect(result).toEqual(['MIT', 'Harvard'])
  })

  it('returns null when response is not an array', async () => {
    const mockClient = makeCreateClient(JSON.stringify({ name: 'MIT' }))
    const result = await createAnthropicProvider('sk-test', null, mockClient).extractAffiliationsWithAI('text')
    expect(result).toBeNull()
  })

  it('returns null when the API call throws', async () => {
    const mockClient = {
      messages: { create: vi.fn().mockRejectedValue(new Error('rate limit')), stream: vi.fn() }
    }
    const result = await createAnthropicProvider('sk-test', null, mockClient).extractAffiliationsWithAI('text')
    expect(result).toBeNull()
  })
})

// ─── extractPaperMetadata ─────────────────────────────────────────────────────

describe('Anthropic provider — extractPaperMetadata', () => {
  it('returns title, authors and abstract', async () => {
    const meta = { title: 'My Paper', authors: 'Alice', abstract: 'We study...' }
    const mockClient = makeCreateClient(JSON.stringify(meta))
    const result = await createAnthropicProvider('sk-test', null, mockClient).extractPaperMetadata('text')
    expect(result).toMatchObject(meta)
  })

  it('returns empty strings when the API throws', async () => {
    const mockClient = {
      messages: { create: vi.fn().mockRejectedValue(new Error('timeout')), stream: vi.fn() }
    }
    const result = await createAnthropicProvider('sk-test', null, mockClient).extractPaperMetadata('text')
    expect(result).toEqual({ title: '', authors: '', abstract: '' })
  })
})

// ─── summarizeAbstract ────────────────────────────────────────────────────────

describe('Anthropic provider — summarizeAbstract', () => {
  it('calls messages.create and returns the trimmed text', async () => {
    const mockClient = makeCreateClient('  A short summary.  ')
    const result = await createAnthropicProvider('sk-test', null, mockClient).summarizeAbstract('We study diffusion models.')
    expect(mockClient.messages.create).toHaveBeenCalledOnce()
    expect(result).toBe('A short summary.')
  })

  it('includes the abstract text in the prompt', async () => {
    const mockClient = makeCreateClient('summary')
    await createAnthropicProvider('sk-test', null, mockClient).summarizeAbstract('Unique abstract content XYZ')
    const args = mockClient.messages.create.mock.calls[0][0]
    expect(args.messages[0].content).toContain('Unique abstract content XYZ')
  })

  it('falls back to a truncated abstract when the API call throws', async () => {
    const mockClient = {
      messages: { create: vi.fn().mockRejectedValue(new Error('rate limit')), stream: vi.fn() }
    }
    const longAbstract = 'x'.repeat(500)
    const result = await createAnthropicProvider('sk-test', null, mockClient).summarizeAbstract(longAbstract)
    expect(result).toBe(longAbstract.slice(0, 200))
  })
})

// ─── transcribePageToMarkdown ─────────────────────────────────────────────────

function makeVisionClient(text, usage = { input_tokens: 100, output_tokens: 500 }) {
  return {
    messages: {
      stream: vi.fn(),
      create: vi.fn().mockResolvedValue({ content: [textBlock(text)], usage }),
    }
  }
}

describe('Anthropic provider — transcribePageToMarkdown', () => {
  const B64 = 'aGVsbG8='

  it('sends the page image as a base64 image block', async () => {
    const mockClient = makeVisionClient('# Página\nTexto transcripto.')
    await createAnthropicProvider('sk-test', null, mockClient).transcribePageToMarkdown(B64, 'image/png')
    const args = mockClient.messages.create.mock.calls[0][0]
    const imgBlock = args.messages[0].content.find(b => b.type === 'image')
    expect(imgBlock.source).toMatchObject({ type: 'base64', media_type: 'image/png', data: B64 })
  })

  it('returns the transcribed markdown text', async () => {
    const mockClient = makeVisionClient('## Sección 1\nContenido.')
    const result = await createAnthropicProvider('sk-test', null, mockClient).transcribePageToMarkdown(B64)
    expect(result).toBe('## Sección 1\nContenido.')
  })

  it('uses a much larger max_tokens than interpretImage (exhaustive transcription)', async () => {
    const mockClient = makeVisionClient('text')
    await createAnthropicProvider('sk-test', null, mockClient).transcribePageToMarkdown(B64)
    const args = mockClient.messages.create.mock.calls[0][0]
    expect(args.max_tokens).toBeGreaterThanOrEqual(4000)
  })

  it('reports usage via onUsage on success', async () => {
    const mockClient = makeVisionClient('text', { input_tokens: 123, output_tokens: 456 })
    const onUsage = vi.fn()
    await createAnthropicProvider('sk-test', null, mockClient).transcribePageToMarkdown(B64, 'image/png', { onUsage })
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ prompt_tokens: 123, completion_tokens: 456 }))
  })

  it('does not report usage when the call throws', async () => {
    const mockClient = { messages: { create: vi.fn().mockRejectedValue(new Error('rate limit')), stream: vi.fn() } }
    const onUsage = vi.fn()
    await expect(
      createAnthropicProvider('sk-test', null, mockClient).transcribePageToMarkdown(B64, 'image/png', { onUsage })
    ).rejects.toThrow()
    expect(onUsage).not.toHaveBeenCalled()
  })
})

// ─── interpretFigureInDepth ───────────────────────────────────────────────────

describe('Anthropic provider — interpretFigureInDepth', () => {
  const B64 = 'aGVsbG8='

  it('returns the in-depth interpretation text', async () => {
    const mockClient = makeVisionClient('La figura 2 muestra la arquitectura...')
    const result = await createAnthropicProvider('sk-test', null, mockClient).interpretFigureInDepth(B64)
    expect(result).toBe('La figura 2 muestra la arquitectura...')
  })

  it('reports usage via onUsage on success', async () => {
    const mockClient = makeVisionClient('desc', { input_tokens: 10, output_tokens: 90 })
    const onUsage = vi.fn()
    await createAnthropicProvider('sk-test', null, mockClient).interpretFigureInDepth(B64, 'image/png', { onUsage })
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ prompt_tokens: 10, completion_tokens: 90 }))
  })
})

// ─── chat ─────────────────────────────────────────────────────────────────────

describe('Anthropic provider — chat', () => {
  it('extracts system message into the system parameter', async () => {
    const messages = [
      { role: 'system', content: 'You are an expert' },
      { role: 'user',   content: 'Hello' },
    ]
    const mockClient = makeCreateClient('Hi!')
    await createAnthropicProvider('sk-test', null, mockClient).chat(messages)
    const args = mockClient.messages.create.mock.calls[0][0]
    expect(args.system).toBe('You are an expert')
  })

  it('excludes system role from the messages array', async () => {
    const messages = [
      { role: 'system', content: 'Context' },
      { role: 'user',   content: 'Question' },
    ]
    const mockClient = makeCreateClient('Answer')
    await createAnthropicProvider('sk-test', null, mockClient).chat(messages)
    const args = mockClient.messages.create.mock.calls[0][0]
    expect(args.messages.every(m => m.role !== 'system')).toBe(true)
  })

  it('works without a system message', async () => {
    const messages = [{ role: 'user', content: 'Hi' }]
    const mockClient = makeCreateClient('Hello!')
    await expect(
      createAnthropicProvider('sk-test', null, mockClient).chat(messages)
    ).resolves.not.toThrow()
  })

  it('returns the assistant response text', async () => {
    const mockClient = makeCreateClient('Respuesta final.')
    const result = await createAnthropicProvider('sk-test', null, mockClient).chat([
      { role: 'user', content: '¿Qué es esto?' }
    ])
    expect(result).toBe('Respuesta final.')
  })

  it('preserves conversation history in the messages array', async () => {
    const messages = [
      { role: 'system',    content: 'Context' },
      { role: 'user',      content: 'First question' },
      { role: 'assistant', content: 'First answer' },
      { role: 'user',      content: 'Second question' },
    ]
    const mockClient = makeCreateClient('Second answer')
    await createAnthropicProvider('sk-test', null, mockClient).chat(messages)
    const args = mockClient.messages.create.mock.calls[0][0]
    expect(args.messages).toHaveLength(3) // system removed, 3 non-system remain
    expect(args.messages[2].content).toBe('Second question')
  })
})
