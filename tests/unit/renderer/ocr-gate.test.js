import { describe, it, expect } from 'vitest'
import { needsOcr } from '../../../renderer/modules/ocr-gate.js'

// Misma regla que src/ingestion/ocr-gate.js, para avisar al usuario SIN esperar
// la respuesta del proceso principal (el backend la vuelve a imponer).
describe('needsOcr', () => {
  it('is true for a paper whose text did not come from OCR', () => {
    expect(needsOcr({ pdf_text_source: 'pdf-parse' })).toBe(true)
    expect(needsOcr({ pdf_text_source: null })).toBe(true)
    expect(needsOcr({})).toBe(true)
  })

  it('is false once the paper has OCR text', () => {
    expect(needsOcr({ pdf_text_source: 'ocr' })).toBe(false)
  })

  it('is false when there is no active paper (nothing to gate)', () => {
    expect(needsOcr(null)).toBe(false)
    expect(needsOcr(undefined)).toBe(false)
  })
})
