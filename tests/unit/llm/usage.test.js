import { describe, it, expect, vi } from 'vitest'
import { createAnthropicProvider } from '../../../src/llm/providers/anthropic.js'
import { createOpenAIProvider } from '../../../src/llm/providers/openai.js'
import { createOpenAIEmbeddingProvider } from '../../../src/embeddings/providers/openai.js'
import { createLocalEmbeddingProvider } from '../../../src/embeddings/providers/local.js'
import { createTranscription } from '../../../src/transcription/index.js'

// La instrumentación vive DENTRO del proveedor, no en cada IPC handler: así un
// call site nuevo queda cubierto sin que nadie se acuerde de registrar el uso.

const PAPER = { title: 'T', authors: 'A', abstract: 'Ab', pdf_text: 'text' }
const QUIZ = JSON.stringify({ questions: [] })

// ─── Anthropic ────────────────────────────────────────────────────────────────

describe('anthropic provider — usage recording', () => {
  function makeClient({ usage = { input_tokens: 1000, output_tokens: 500 }, text = 'hola' } = {}) {
    return {
      messages: {
        create: vi.fn().mockResolvedValue({ content: [{ type: 'text', text }], usage }),
        stream: vi.fn().mockReturnValue({
          textStream: (async function* () { yield 'chunk' })(),
          // Anthropic reporta el uso en el mensaje final del stream, no en cada chunk.
          finalMessage: vi.fn().mockResolvedValue({ usage }),
        }),
      },
    }
  }

  it('records usage from the final message of a summary stream', async () => {
    const onUsage = vi.fn()
    const llm = createAnthropicProvider('sk-test', 'claude-opus-4-8', makeClient(), onUsage)

    await llm.streamSummary(PAPER, () => {})

    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({
      action_type: 'summary', provider: 'anthropic', model: 'claude-opus-4-8',
      prompt_tokens: 1000, completion_tokens: 500,
    }))
  })

  it('records usage for chat, quiz, metadata, affiliations, abstract summary and vision', async () => {
    const onUsage = vi.fn()
    const llm = createAnthropicProvider('sk-test', 'claude-opus-4-8', makeClient({ text: QUIZ }), onUsage)

    await llm.chat([{ role: 'user', content: 'hi' }])
    await llm.generateQuiz(PAPER)
    await llm.extractPaperMetadata('first page')
    await llm.extractAffiliationsWithAI('MIT')
    await llm.summarizeAbstract('abstract')
    await llm.interpretImage('base64')

    const actions = onUsage.mock.calls.map(c => c[0].action_type)
    expect(actions).toEqual(['chat', 'quiz', 'metadata', 'affiliations', 'abstract_summary', 'vision'])
  })

  // summarizeAbstract corre en CADA pdf de referencia indexado — es de los
  // métodos que más se llaman, y el PRD lo había omitido.
  it('records abstract_summary, which runs on every indexed reference PDF', async () => {
    const onUsage = vi.fn()
    const llm = createAnthropicProvider('sk-test', null, makeClient(), onUsage)
    await llm.summarizeAbstract('un abstract')
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ action_type: 'abstract_summary', prompt_tokens: 1000 }))
  })

  it('does not record usage when the call fails', async () => {
    const onUsage = vi.fn()
    const client = { messages: { create: vi.fn().mockRejectedValue(new Error('boom')), stream: vi.fn() } }
    const llm = createAnthropicProvider('sk-test', null, client, onUsage)

    await llm.summarizeAbstract('abstract')  // traga el error y devuelve fallback

    expect(onUsage).not.toHaveBeenCalled()
  })

  it('works with no recorder attached', async () => {
    const llm = createAnthropicProvider('sk-test', null, makeClient())
    await expect(llm.chat([{ role: 'user', content: 'hi' }])).resolves.toBe('hola')
  })

  // El OCR y la interpretación de figuras se contabilizan bajo su propio
  // action_type cada uno, para que el dashboard distinga cuánto se gastó en
  // transcribir texto de página vs. interpretar figuras.
  it('records transcribePageToMarkdown and interpretFigureInDepth under their own action_type', async () => {
    const onUsage = vi.fn()
    const llm = createAnthropicProvider('sk-test', 'claude-opus-4-8', makeClient(), onUsage)

    await llm.transcribePageToMarkdown('base64', 'image/png')
    await llm.interpretFigureInDepth('base64', 'image/png')

    const actions = onUsage.mock.calls.map(c => c[0].action_type)
    expect(actions).toEqual(['ocr', 'ocr_figure'])
  })
})

// ─── OpenAI ───────────────────────────────────────────────────────────────────

describe('openai provider — usage recording', () => {
  const USAGE = { prompt_tokens: 800, completion_tokens: 200 }

  // streamUsage: null simula un proveedor que no reporta uso en el stream.
  function makeClient({ content = 'hola', streamUsage = USAGE } = {}) {
    async function* stream() {
      yield { choices: [{ delta: { content: 'chunk' } }] }
      // OpenAI manda el usage en un último chunk sin choices, y SOLO si se pidió
      // stream_options.include_usage.
      yield streamUsage ? { choices: [], usage: streamUsage } : { choices: [] }
    }
    return {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(params =>
            params.stream ? stream() : Promise.resolve({ choices: [{ message: { content } }], usage: USAGE })
          ),
        },
      },
    }
  }

  // Sin include_usage, OpenAI no devuelve uso en streaming y TODOS los resúmenes
  // quedarían sin costo — es el flujo más caro de la app.
  it('asks for usage in the stream, otherwise summaries would never be priced', async () => {
    const client = makeClient()
    const llm = createOpenAIProvider('sk-test', 'gpt-4o', client, vi.fn())

    await llm.streamSummary(PAPER, () => {})

    expect(client.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({ stream: true, stream_options: { include_usage: true } })
    )
  })

  it('records usage from the final chunk of a summary stream', async () => {
    const onUsage = vi.fn()
    const llm = createOpenAIProvider('sk-test', 'gpt-4o', makeClient(), onUsage)

    await llm.streamSummary(PAPER, () => {})

    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({
      action_type: 'summary', provider: 'openai', model: 'gpt-4o',
      prompt_tokens: 800, completion_tokens: 200,
    }))
  })

  // Si el proveedor no reporta uso, se registra igual el evento sin tokens: el
  // dashboard lo muestra como "costo desconocido" en vez de perder la llamada.
  it('still records the call when the stream reports no usage', async () => {
    const onUsage = vi.fn()
    const llm = createOpenAIProvider('sk-test', 'gpt-4o', makeClient({ streamUsage: null }), onUsage)

    await llm.streamSummary(PAPER, () => {})

    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ action_type: 'summary', prompt_tokens: null }))
  })

  it('records chat and abstract_summary', async () => {
    const onUsage = vi.fn()
    const llm = createOpenAIProvider('sk-test', 'gpt-4o', makeClient(), onUsage)

    await llm.chat([{ role: 'user', content: 'hi' }])
    await llm.summarizeAbstract('abstract')

    expect(onUsage.mock.calls.map(c => c[0].action_type)).toEqual(['chat', 'abstract_summary'])
  })

  it('records transcribePageToMarkdown and interpretFigureInDepth under their own action_type', async () => {
    const onUsage = vi.fn()
    const llm = createOpenAIProvider('sk-test', 'gpt-4o', makeClient(), onUsage)

    await llm.transcribePageToMarkdown('base64', 'image/png')
    await llm.interpretFigureInDepth('base64', 'image/png')

    const actions = onUsage.mock.calls.map(c => c[0].action_type)
    expect(actions).toEqual(['ocr', 'ocr_figure'])
  })
})

// ─── Embeddings ───────────────────────────────────────────────────────────────

describe('embeddings — usage recording', () => {
  it('records the tokens OpenAI reports for an embedding', async () => {
    const onUsage = vi.fn()
    const client = { embeddings: { create: vi.fn().mockResolvedValue({ data: [{ embedding: [0.1] }], usage: { total_tokens: 640 } }) } }
    const emb = createOpenAIEmbeddingProvider('sk-test', {}, client, onUsage)

    await emb.generateEmbedding('un texto')

    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({
      action_type: 'embedding', provider: 'openai', model: 'text-embedding-3-small', prompt_tokens: 640,
    }))
  })

  // El motor local es gratis, pero tiene que aparecer en el dashboard como
  // "Local — $0", no desaparecer del desglose.
  it('records local embeddings as a free event under the local provider', async () => {
    const onUsage = vi.fn()
    const pipeline = vi.fn().mockResolvedValue({ data: Float32Array.from([0.5]) })
    const emb = createLocalEmbeddingProvider({}, pipeline, null, onUsage)

    await emb.generateEmbedding('un texto')

    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ action_type: 'embedding', provider: 'local' }))
  })
})

// ─── Transcripción ────────────────────────────────────────────────────────────

describe('transcription — usage recording', () => {
  // Whisper cobra por audio: sin verbose_json la API no devuelve la duración y
  // no habría con qué calcular el costo.
  it('asks whisper for verbose_json and records the real audio duration', async () => {
    const onUsage = vi.fn()
    const create = vi.fn().mockResolvedValue({ text: 'hola', duration: 125.5 })
    const stt = createTranscription('gsk-test', { provider: 'groq' }, { audio: { transcriptions: { create } } }, onUsage)

    await stt.transcribe(Buffer.from('audio'))

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ response_format: 'verbose_json' }))
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({
      action_type: 'transcription', provider: 'groq', model: 'whisper-large-v3-turbo', audio_seconds: 125.5,
    }))
  })

  // gpt-4o-mini-transcribe NO factura por minuto sino por tokens, y encima no
  // soporta verbose_json — hay que leer su `usage` en vez de la duración.
  it('records tokens (not seconds) for the gpt-4o transcribe models, which bill per token', async () => {
    const onUsage = vi.fn()
    const create = vi.fn().mockResolvedValue({ text: 'hola', usage: { type: 'tokens', input_tokens: 900, output_tokens: 40 } })
    const stt = createTranscription('sk-test', { provider: 'openai' }, { audio: { transcriptions: { create } } }, onUsage)

    await stt.transcribe(Buffer.from('audio'))

    expect(create).not.toHaveBeenCalledWith(expect.objectContaining({ response_format: 'verbose_json' }))
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({
      action_type: 'transcription', provider: 'openai', model: 'gpt-4o-mini-transcribe',
      prompt_tokens: 900, completion_tokens: 40,
    }))
  })

  it('still returns the transcript text unchanged', async () => {
    const create = vi.fn().mockResolvedValue({ text: 'el texto', duration: 10 })
    const stt = createTranscription('gsk-test', { provider: 'groq' }, { audio: { transcriptions: { create } } })
    expect(await stt.transcribe(Buffer.from('audio'))).toEqual({ text: 'el texto' })
  })
})
