import { describe, it, expect, vi } from 'vitest'
import { transcribePdfToMarkdown } from '../../../src/ingestion/ocr.js'

const PAGES = [
  { base64: 'cA==', mimeType: 'image/png' },
  { base64: 'cB==', mimeType: 'image/png' },
]

function makeRasterizer(pages = PAGES) {
  return vi.fn().mockResolvedValue(pages)
}

function makeVisionLLM(perPage) {
  return {
    transcribePageToMarkdown: vi.fn(async (b64) => {
      const idx = PAGES.findIndex(p => p.base64 === b64)
      const out = perPage[idx]
      if (out instanceof Error) throw out
      return out
    }),
  }
}

function makePagesExtractor(pages) {
  return vi.fn().mockResolvedValue({ success: true, pages })
}

describe('transcribePdfToMarkdown — happy path', () => {
  it('transcribes every page and concatenates with per-page markers', async () => {
    const llm = makeVisionLLM(['# Page one', '# Page two'])
    const result = await transcribePdfToMarkdown(Buffer.from('pdf'), {
      rasterizePdf: makeRasterizer(),
      llm,
      pdfParse: vi.fn(),
      extractPagesText: makePagesExtractor(['fb1', 'fb2']),
    })
    expect(result.success).toBe(true)
    expect(result.markdown).toContain('<!-- page 1 · source: ocr -->')
    expect(result.markdown).toContain('# Page one')
    expect(result.markdown).toContain('<!-- page 2 · source: ocr -->')
    expect(result.markdown).toContain('# Page two')
    expect(result.fallbackUsed).toBe(false)
    expect(result.pageCount).toBe(2)
  })

  it('calls transcribePageToMarkdown once per page', async () => {
    const llm = makeVisionLLM(['a', 'b'])
    await transcribePdfToMarkdown(Buffer.from('pdf'), {
      rasterizePdf: makeRasterizer(), llm, pdfParse: vi.fn(),
      extractPagesText: makePagesExtractor(['fb1', 'fb2']),
    })
    expect(llm.transcribePageToMarkdown).toHaveBeenCalledTimes(2)
  })

  it('reports progress per page via onProgress', async () => {
    const llm = makeVisionLLM(['a', 'b'])
    const onProgress = vi.fn()
    await transcribePdfToMarkdown(Buffer.from('pdf'), {
      rasterizePdf: makeRasterizer(), llm, pdfParse: vi.fn(),
      extractPagesText: makePagesExtractor(['fb1', 'fb2']), onProgress,
    })
    expect(onProgress).toHaveBeenCalledWith(1, 2)
    expect(onProgress).toHaveBeenCalledWith(2, 2)
  })

  it('calls transcribePageToMarkdown with just the page image, no options object', async () => {
    const llm = makeVisionLLM(['a', 'b'])
    await transcribePdfToMarkdown(Buffer.from('pdf'), {
      rasterizePdf: makeRasterizer(), llm, pdfParse: vi.fn(),
      extractPagesText: makePagesExtractor(['fb1', 'fb2']),
    })
    expect(llm.transcribePageToMarkdown).toHaveBeenCalledWith('cA==', 'image/png')
  })
})

describe('transcribePdfToMarkdown — strips a fence the LLM wraps its whole answer in', () => {
  // Modelos de visión suelen envolver TODA la transcripción en un fence
  // ```markdown ... ``` aunque el prompt pida solo el Markdown — el mismo hábito
  // que ya se maneja para JSON en parseJSONResponse (src/llm/prompts.js).
  it('strips a ```markdown fence wrapping the whole page', async () => {
    const llm = makeVisionLLM(['```markdown\n# Título\n\nTexto de la página.\n```', 'segunda página'])
    const result = await transcribePdfToMarkdown(Buffer.from('pdf'), {
      rasterizePdf: makeRasterizer(), llm, pdfParse: vi.fn(),
      extractPagesText: makePagesExtractor(['fb1', 'fb2']),
    })
    expect(result.markdown).toContain('# Título')
    expect(result.markdown).toContain('Texto de la página.')
    expect(result.markdown).not.toContain('```')
  })

  it('strips a bare ``` fence with no language tag', async () => {
    const llm = makeVisionLLM(['```\n# Título\n```', 'segunda página'])
    const result = await transcribePdfToMarkdown(Buffer.from('pdf'), {
      rasterizePdf: makeRasterizer(), llm, pdfParse: vi.fn(),
      extractPagesText: makePagesExtractor(['fb1', 'fb2']),
    })
    expect(result.markdown).toContain('# Título')
    expect(result.markdown).not.toContain('```')
  })

  it('leaves a genuine inner code block (pseudocode in the transcription) untouched', async () => {
    const withInnerFence = '# Algoritmo\n\n```python\nfor x in xs:\n    pass\n```\n\nTexto después.'
    const llm = makeVisionLLM([withInnerFence, 'segunda página'])
    const result = await transcribePdfToMarkdown(Buffer.from('pdf'), {
      rasterizePdf: makeRasterizer(), llm, pdfParse: vi.fn(),
      extractPagesText: makePagesExtractor(['fb1', 'fb2']),
    })
    expect(result.markdown).toContain('```python')
    expect(result.markdown).toContain('for x in xs:')
  })

  it('also strips a wrapping fence from the figure interpretation', async () => {
    const llm = {
      transcribePageToMarkdown: vi.fn().mockResolvedValue('md'),
      interpretFigureInDepth: vi.fn().mockResolvedValue('```markdown\nFigura: arquitectura\n```'),
    }
    const result = await transcribePdfToMarkdown(Buffer.from('pdf'), {
      rasterizePdf: makeRasterizer(), llm, pdfParse: vi.fn(),
      extractPagesText: makePagesExtractor(['fb1', 'fb2']),
    })
    expect(result.markdown).toContain('Figura: arquitectura')
    expect(result.markdown).not.toContain('```')
  })
})

describe('transcribePdfToMarkdown — concurrency', () => {
  function makePages(n) {
    return Array.from({ length: n }, (_, i) => ({ base64: `p${i}`, mimeType: 'image/png' }))
  }

  it('runs pages concurrently instead of strictly one at a time', async () => {
    const pages = makePages(6)
    let inFlight = 0, maxInFlight = 0
    const llm = {
      transcribePageToMarkdown: vi.fn(async () => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise(r => setTimeout(r, 10))
        inFlight--
        return 'md'
      }),
    }
    await transcribePdfToMarkdown(Buffer.from('pdf'), {
      rasterizePdf: makeRasterizer(pages), llm, pdfParse: vi.fn(),
      extractPagesText: makePagesExtractor(Array(6).fill('fb')),
    })
    expect(maxInFlight).toBeGreaterThan(1)
  })

  it('caps concurrency at the given `concurrency` option', async () => {
    const pages = makePages(8)
    let inFlight = 0, maxInFlight = 0
    const llm = {
      transcribePageToMarkdown: vi.fn(async () => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise(r => setTimeout(r, 10))
        inFlight--
        return 'md'
      }),
    }
    await transcribePdfToMarkdown(Buffer.from('pdf'), {
      rasterizePdf: makeRasterizer(pages), llm, pdfParse: vi.fn(),
      extractPagesText: makePagesExtractor(Array(8).fill('fb')),
      concurrency: 3,
    })
    expect(maxInFlight).toBeLessThanOrEqual(3)
  })

  it('defaults to a concurrency of 4 when not specified', async () => {
    const pages = makePages(8)
    let inFlight = 0, maxInFlight = 0
    const llm = {
      transcribePageToMarkdown: vi.fn(async () => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise(r => setTimeout(r, 10))
        inFlight--
        return 'md'
      }),
    }
    await transcribePdfToMarkdown(Buffer.from('pdf'), {
      rasterizePdf: makeRasterizer(pages), llm, pdfParse: vi.fn(),
      extractPagesText: makePagesExtractor(Array(8).fill('fb')),
    })
    expect(maxInFlight).toBe(4)
  })

  it('keeps pages in order in the final markdown regardless of completion order', async () => {
    const pages = makePages(4)
    // La página 0 es la más lenta y la 3 la más rápida — si el orden final
    // dependiera del orden de resolución, quedaría mezclado.
    const delays = [30, 20, 10, 1]
    const llm = {
      transcribePageToMarkdown: vi.fn(async (base64) => {
        const i = Number(base64.slice(1))
        await new Promise(r => setTimeout(r, delays[i]))
        return `md-${i}`
      }),
    }
    const result = await transcribePdfToMarkdown(Buffer.from('pdf'), {
      rasterizePdf: makeRasterizer(pages), llm, pdfParse: vi.fn(),
      extractPagesText: makePagesExtractor(Array(4).fill('fb')),
    })
    const positions = [0, 1, 2, 3].map(i => result.markdown.indexOf(`md-${i}`))
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  it('reports progress as pages complete, not strictly in page order', async () => {
    const pages = makePages(4)
    const onProgress = vi.fn()
    const llm = { transcribePageToMarkdown: vi.fn().mockResolvedValue('md') }
    await transcribePdfToMarkdown(Buffer.from('pdf'), {
      rasterizePdf: makeRasterizer(pages), llm, pdfParse: vi.fn(),
      extractPagesText: makePagesExtractor(Array(4).fill('fb')),
      onProgress,
    })
    expect(onProgress).toHaveBeenCalledTimes(4)
    expect(onProgress).toHaveBeenCalledWith(4, 4)
  })
})

describe('transcribePdfToMarkdown — per-page fallback', () => {
  it('falls back to pdf-parse text for a page whose vision call fails, marked explicitly', async () => {
    const llm = makeVisionLLM(['# Page one', new Error('rate_limit')])
    const result = await transcribePdfToMarkdown(Buffer.from('pdf'), {
      rasterizePdf: makeRasterizer(), llm, pdfParse: vi.fn(),
      extractPagesText: makePagesExtractor(['fb1', 'fallback text for two']),
    })
    expect(result.success).toBe(true)
    expect(result.markdown).toContain('# Page one')
    expect(result.markdown).toMatch(/page 2 · source: pdf-parse fallback \(vision error: rate_limit\)/)
    expect(result.markdown).toContain('fallback text for two')
    expect(result.fallbackUsed).toBe(true)
  })

  it('marks [ilegible] when neither vision nor pdf-parse produced text for a page', async () => {
    const llm = makeVisionLLM([new Error('boom'), '# Page two'])
    const result = await transcribePdfToMarkdown(Buffer.from('pdf'), {
      rasterizePdf: makeRasterizer(), llm, pdfParse: vi.fn(),
      extractPagesText: vi.fn().mockResolvedValue({ success: false, error: 'corrupt' }),
    })
    expect(result.success).toBe(true)
    expect(result.markdown).toContain('[ilegible]')
    expect(result.fallbackUsed).toBe(true)
  })

  it('a single page failure does not abort the whole run', async () => {
    const llm = makeVisionLLM([new Error('boom'), '# Page two'])
    const result = await transcribePdfToMarkdown(Buffer.from('pdf'), {
      rasterizePdf: makeRasterizer(), llm, pdfParse: vi.fn(),
      extractPagesText: makePagesExtractor(['fb1', 'fb2']),
    })
    expect(result.success).toBe(true)
    expect(result.markdown).toContain('# Page two')
  })
})

describe('transcribePdfToMarkdown — total failure', () => {
  it('returns no-vision error when the llm has no transcribePageToMarkdown', async () => {
    const result = await transcribePdfToMarkdown(Buffer.from('pdf'), {
      rasterizePdf: makeRasterizer(), llm: { chat: vi.fn() }, pdfParse: vi.fn(),
    })
    expect(result.success).toBe(false)
    expect(result.error).toBe('no-vision')
    expect(result.markdown).toBeNull()
  })

  it('returns no-rasterizer error when rasterizePdf is unavailable', async () => {
    const result = await transcribePdfToMarkdown(Buffer.from('pdf'), {
      rasterizePdf: null, llm: makeVisionLLM(['a']), pdfParse: vi.fn(),
    })
    expect(result.success).toBe(false)
    expect(result.error).toBe('no-rasterizer')
  })

  it('returns failure (does not throw) when rasterization itself throws', async () => {
    const result = await transcribePdfToMarkdown(Buffer.from('pdf'), {
      rasterizePdf: vi.fn().mockRejectedValue(new Error('window crashed')),
      llm: makeVisionLLM(['a']), pdfParse: vi.fn(),
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('window crashed')
  })
})

describe('transcribePdfToMarkdown — figure interpretation (default behavior)', () => {
  it('calls interpretFigureInDepth for every page whenever the provider supports it', async () => {
    const llm = {
      transcribePageToMarkdown: vi.fn().mockResolvedValue('md'),
      interpretFigureInDepth: vi.fn().mockResolvedValue('Figura: arquitectura'),
    }
    const result = await transcribePdfToMarkdown(Buffer.from('pdf'), {
      rasterizePdf: makeRasterizer(), llm, pdfParse: vi.fn(),
      extractPagesText: makePagesExtractor(['fb1', 'fb2']),
    })
    expect(llm.interpretFigureInDepth).toHaveBeenCalledTimes(2)
    expect(llm.interpretFigureInDepth).toHaveBeenCalledWith('cA==', 'image/png')
    expect(result.markdown).toContain('Figura: arquitectura')
  })

  it('skips figure interpretation when the provider does not implement it (e.g. DeepSeek)', async () => {
    const llm = { transcribePageToMarkdown: vi.fn().mockResolvedValue('md') }
    const result = await transcribePdfToMarkdown(Buffer.from('pdf'), {
      rasterizePdf: makeRasterizer(), llm, pdfParse: vi.fn(),
      extractPagesText: makePagesExtractor(['fb1', 'fb2']),
    })
    expect(result.success).toBe(true)
    expect(result.markdown).not.toContain('figures')
  })

  it("a failed figure interpretation on one page doesn't break that page's OCR", async () => {
    const llm = {
      transcribePageToMarkdown: vi.fn().mockResolvedValue('md'),
      interpretFigureInDepth: vi.fn().mockRejectedValue(new Error('boom')),
    }
    const result = await transcribePdfToMarkdown(Buffer.from('pdf'), {
      rasterizePdf: makeRasterizer(), llm, pdfParse: vi.fn(),
      extractPagesText: makePagesExtractor(['fb1', 'fb2']),
    })
    expect(result.success).toBe(true)
    expect(result.markdown).toContain('md')
  })
})
