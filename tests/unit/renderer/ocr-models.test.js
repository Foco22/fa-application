import { describe, it, expect } from 'vitest'
import { LLM_PROVIDERS } from '../../../renderer/modules/constants.js'

// El selector de modelo de la pestaña OCR solo ofrece modelos que SÍ ven imágenes:
// elegir uno sin visión haría fallar el OCR página por página.
describe('LLM_PROVIDERS.visionModels', () => {
  it('every vision model is also a selectable model of its provider', () => {
    for (const [name, cfg] of Object.entries(LLM_PROVIDERS)) {
      for (const model of cfg.visionModels) {
        expect(cfg.models, `${name}/${model}`).toContain(model)
      }
    }
  })

  it('OpenAI and Anthropic offer vision models', () => {
    expect(LLM_PROVIDERS.openai.visionModels.length).toBeGreaterThan(0)
    expect(LLM_PROVIDERS.anthropic.visionModels.length).toBeGreaterThan(0)
  })

  it('DeepSeek has none (no vision), so the OCR tab points the user to LlamaParse', () => {
    expect(LLM_PROVIDERS.deepseek.visionModels).toEqual([])
  })

  it('does not offer o3-mini, which cannot read images', () => {
    expect(LLM_PROVIDERS.openai.visionModels).not.toContain('o3-mini')
  })
})
