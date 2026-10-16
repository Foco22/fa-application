import { describe, it, expect } from 'vitest'
import { hasOcr, OCR_REQUIRED } from '../../../src/ingestion/ocr-gate.js'

// Regla de producto: resumen, quiz, clase y chat con el paper solo corren sobre el
// texto del OCR. El texto básico de pdf-parse (recortado, sin tablas ni fórmulas) no basta.
describe('hasOcr', () => {
  it('is true only when the paper text comes from OCR', () => {
    expect(hasOcr({ pdf_text_source: 'ocr' })).toBe(true)
  })

  it.each([
    ['pdf-parse', { pdf_text_source: 'pdf-parse' }],
    ['null source (papers from before the OCR feature)', { pdf_text_source: null }],
    ['missing source', {}],
  ])('is false for %s', (_name, paper) => {
    expect(hasOcr(paper)).toBe(false)
  })

  it('is false when there is no paper', () => {
    expect(hasOcr(null)).toBe(false)
    expect(hasOcr(undefined)).toBe(false)
  })

  it('uses a stable error code the UI can recognise', () => {
    expect(OCR_REQUIRED).toBe('ocr-required')
  })
})
