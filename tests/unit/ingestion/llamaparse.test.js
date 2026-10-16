import { describe, it, expect, vi } from 'vitest'
import { parsePdfWithLlamaParse } from '../../../src/ingestion/llamaparse.js'

// Nunca se llama a la API real: el cliente HTTP se inyecta (mismo patrón que los
// proveedores de IA). La clave de estos tests es falsa a propósito.
const KEY = 'llx-test-key-0000'
const PDF = Buffer.from('%PDF-1.4 fake')
const noSleep = () => Promise.resolve()

function httpError(status, message = `Request failed with status code ${status}`) {
  return Object.assign(new Error(message), { response: { status, data: { detail: message } } })
}

// upload → create job → poll. `polls` son las respuestas sucesivas del GET.
function makeHttp({ polls = [{ job: { status: 'COMPLETED' }, markdown: { pages: [{ markdown: '# A' }, { markdown: 'B' }] } }] } = {}) {
  const queue = [...polls]
  return {
    post: vi.fn().mockImplementation(async (url) => {
      if (url.endsWith('/api/v1/beta/files')) return { data: { id: 'file-1' } }
      if (url.endsWith('/api/v2/parse'))      return { data: { id: 'job-1', status: 'PENDING' } }
      throw new Error(`unexpected POST ${url}`)
    }),
    get: vi.fn().mockImplementation(async () => ({ data: queue.length > 1 ? queue.shift() : queue[0] })),
  }
}

describe('parsePdfWithLlamaParse — happy path', () => {
  it('uploads the PDF, starts the job, polls and returns the markdown of all pages', async () => {
    const http = makeHttp()

    const result = await parsePdfWithLlamaParse(PDF, { apiKey: KEY, httpClient: http, sleepFn: noSleep })

    expect(result).toEqual({ success: true, markdown: '# A\n\nB', pageCount: 2 })
  })

  it('uploads with purpose=parse and the file as a PDF blob', async () => {
    const http = makeHttp()

    await parsePdfWithLlamaParse(PDF, { apiKey: KEY, httpClient: http, sleepFn: noSleep })

    const [url, form] = http.post.mock.calls[0]
    expect(url).toBe('https://api.cloud.llamaindex.ai/api/v1/beta/files')
    expect(form.get('purpose')).toBe('parse')
    expect(form.get('file').type).toBe('application/pdf')
  })

  it('starts the job with the uploaded file id, the cost_effective tier (cheapest that returns markdown) and the latest version', async () => {
    const http = makeHttp()

    await parsePdfWithLlamaParse(PDF, { apiKey: KEY, httpClient: http, sleepFn: noSleep })

    const [url, body] = http.post.mock.calls[1]
    expect(url).toBe('https://api.cloud.llamaindex.ai/api/v2/parse')
    expect(body).toMatchObject({ file_id: 'file-1', tier: 'cost_effective', version: 'latest' })
  })

  // Sin esta opción las tablas llegan como HTML (<table><tr><td>…): una celda por
  // línea, que además se inyectan completas en cada prompt de resumen/quiz/chat.
  // Como tablas Markdown (`| a | b |`) son legibles tanto para el LLM como para quien abre el .md.
  it('asks for tables as Markdown pipe tables instead of HTML', async () => {
    const http = makeHttp()

    await parsePdfWithLlamaParse(PDF, { apiKey: KEY, httpClient: http, sleepFn: noSleep })

    expect(http.post.mock.calls[1][1].output_options).toEqual({
      markdown: { tables: { output_tables_as_markdown: true } },
    })
  })

  it('lets the caller pick another tier', async () => {
    const http = makeHttp()

    await parsePdfWithLlamaParse(PDF, { apiKey: KEY, httpClient: http, tier: 'agentic', sleepFn: noSleep })

    expect(http.post.mock.calls[1][1].tier).toBe('agentic')
  })

  it('authenticates every request with a Bearer header and never puts the key in a body or URL', async () => {
    const http = makeHttp()

    await parsePdfWithLlamaParse(PDF, { apiKey: KEY, httpClient: http, sleepFn: noSleep })

    for (const call of [...http.post.mock.calls, ...http.get.mock.calls]) {
      const config = call[call.length - 1]
      expect(config.headers.Authorization).toBe(`Bearer ${KEY}`)
      expect(call[0]).not.toContain(KEY)
    }
    expect(http.post.mock.calls[1][1]).not.toHaveProperty('apiKey')
  })

  it('polls the job asking for the markdown, waiting between PENDING answers', async () => {
    const pending = { job: { status: 'PENDING' } }
    const done = { job: { status: 'COMPLETED' }, markdown: { pages: [{ markdown: 'ok' }] } }
    const http = makeHttp({ polls: [pending, pending, done] })
    const sleepFn = vi.fn().mockResolvedValue()

    const result = await parsePdfWithLlamaParse(PDF, { apiKey: KEY, httpClient: http, sleepFn })

    expect(result.success).toBe(true)
    expect(http.get).toHaveBeenCalledTimes(3)
    expect(http.get.mock.calls[0][0]).toBe('https://api.cloud.llamaindex.ai/api/v2/parse/job-1?expand=markdown')
    expect(sleepFn).toHaveBeenCalledTimes(2)
  })

  it('reports the phases through onStatus', async () => {
    const http = makeHttp()
    const onStatus = vi.fn()

    await parsePdfWithLlamaParse(PDF, { apiKey: KEY, httpClient: http, sleepFn: noSleep, onStatus })

    expect(onStatus.mock.calls.map(c => c[0])).toEqual(['uploading', 'parsing'])
  })
})

describe('parsePdfWithLlamaParse — failures (never throws, never leaks the key)', () => {
  it('fails fast without calling the API when there is no key', async () => {
    const http = makeHttp()

    const result = await parsePdfWithLlamaParse(PDF, { apiKey: '', httpClient: http, sleepFn: noSleep })

    expect(result).toMatchObject({ success: false, error: 'no-api-key' })
    expect(http.post).not.toHaveBeenCalled()
  })

  it('reports a FAILED job with its error message', async () => {
    const http = makeHttp({ polls: [{ job: { status: 'FAILED', error_message: 'corrupt pdf' } }] })

    const result = await parsePdfWithLlamaParse(PDF, { apiKey: KEY, httpClient: http, sleepFn: noSleep })

    expect(result.success).toBe(false)
    expect(result.error).toContain('corrupt pdf')
  })

  it('reports a CANCELLED job', async () => {
    const http = makeHttp({ polls: [{ job: { status: 'CANCELLED' } }] })

    const result = await parsePdfWithLlamaParse(PDF, { apiKey: KEY, httpClient: http, sleepFn: noSleep })

    expect(result.success).toBe(false)
  })

  it('gives up after the timeout instead of polling forever', async () => {
    const http = makeHttp({ polls: [{ job: { status: 'PENDING' } }] })
    let t = 0
    const now = () => (t += 100000)

    const result = await parsePdfWithLlamaParse(PDF, { apiKey: KEY, httpClient: http, sleepFn: noSleep, timeoutMs: 300000, now })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/tard|timeout/i)
  })

  it('fails when the job completes without any page of markdown', async () => {
    const http = makeHttp({ polls: [{ job: { status: 'COMPLETED' }, markdown: { pages: [] } }] })

    const result = await parsePdfWithLlamaParse(PDF, { apiKey: KEY, httpClient: http, sleepFn: noSleep })

    expect(result.success).toBe(false)
  })

  it.each([
    [401, /key/i],
    [402, /cr[eé]dit/i],
    [429, /l[ií]mite|rate/i],
  ])('explains HTTP %i in plain words', async (status, pattern) => {
    const http = makeHttp()
    http.post.mockRejectedValue(httpError(status))

    const result = await parsePdfWithLlamaParse(PDF, { apiKey: KEY, httpClient: http, sleepFn: noSleep })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(pattern)
    expect(result.error).not.toContain(KEY)
  })

  it('never throws on a network error and keeps the key out of the message', async () => {
    const http = makeHttp()
    http.post.mockRejectedValue(new Error(`socket hang up for ${KEY}`))

    const result = await parsePdfWithLlamaParse(PDF, { apiKey: KEY, httpClient: http, sleepFn: noSleep })

    expect(result.success).toBe(false)
    expect(result.error).toContain('socket hang up')
    expect(result.error).not.toContain(KEY)
  })
})
