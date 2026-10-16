import { describe, it, expect } from 'vitest'
import { resolveOcrConfig, LLAMAPARSE_TIERS } from '../../../src/ingestion/ocr-config.js'

describe('resolveOcrConfig — engine', () => {
  it('uses what the user picked in the OCR tab', () => {
    expect(resolveOcrConfig({ ocrEngine: 'vision', llamaParseApiKey: 'llx-1' }).engine).toBe('vision')
    expect(resolveOcrConfig({ ocrEngine: 'llamaparse' }).engine).toBe('llamaparse')
  })

  // Quien ya había pegado su key antes de existir la pestaña OCR no debe perder el comportamiento.
  it('without a choice, a stored LlamaParse key means LlamaParse', () => {
    expect(resolveOcrConfig({ llamaParseApiKey: 'llx-1' }).engine).toBe('llamaparse')
  })

  it('without a choice and without a key, it keeps using the vision model as always', () => {
    expect(resolveOcrConfig({}).engine).toBe('vision')
    expect(resolveOcrConfig({ llamaParseApiKey: '   ' }).engine).toBe('vision')
  })

  it('ignores an unknown engine value', () => {
    expect(resolveOcrConfig({ ocrEngine: 'banana' }).engine).toBe('vision')
  })
})

describe('resolveOcrConfig — LlamaParse', () => {
  it('trims the key and defaults to the cheapest tier that returns markdown', () => {
    const cfg = resolveOcrConfig({ ocrEngine: 'llamaparse', llamaParseApiKey: '  llx-1  ' })

    expect(cfg.llamaParse).toEqual({ apiKey: 'llx-1', tier: 'cost_effective' })
  })

  it('accepts the tiers that produce markdown', () => {
    for (const tier of ['cost_effective', 'agentic', 'agentic_plus']) {
      expect(resolveOcrConfig({ llamaParseTier: tier }).llamaParse.tier).toBe(tier)
    }
  })

  // `fast` no devuelve markdown: elegirlo rompería el OCR en silencio.
  it('falls back to the default for `fast` or any unknown tier', () => {
    expect(resolveOcrConfig({ llamaParseTier: 'fast' }).llamaParse.tier).toBe('cost_effective')
    expect(resolveOcrConfig({ llamaParseTier: 'zzz' }).llamaParse.tier).toBe('cost_effective')
    expect(LLAMAPARSE_TIERS).not.toContain('fast')
  })
})

describe('resolveOcrConfig — vision model', () => {
  it('overrides only the model for OCR, leaving the provider and the rest of the settings alone', () => {
    const settings = { llmProvider: 'openai', llmModel: 'gpt-4o-mini', ocrModel: 'gpt-4o', apiKey: 'sk-1' }

    const cfg = resolveOcrConfig(settings)

    expect(cfg.visionSettings).toEqual({ ...settings, llmModel: 'gpt-4o' })
  })

  it('uses the same model as the LLM when no OCR model is chosen', () => {
    const settings = { llmProvider: 'openai', llmModel: 'gpt-4o-mini', ocrModel: '' }

    expect(resolveOcrConfig(settings).visionSettings.llmModel).toBe('gpt-4o-mini')
  })
})
