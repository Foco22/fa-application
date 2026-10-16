import { describe, it, expect } from 'vitest'
import { canHaveClass } from '../../../src/class/index.js'

describe('canHaveClass', () => {
  const ocrPaper = { status: 'ready', pdf_text: 'Texto completo del OCR.', abstract: 'Abstract.', pdf_text_source: 'ocr' }

  it('allows a class on a paper with OCR text', () => {
    expect(canHaveClass(ocrPaper)).toEqual({ ok: true })
  })

  it('refuses when there is no paper', () => {
    expect(canHaveClass(null)).toMatchObject({ ok: false })
  })

  it('refuses while the paper is still downloading', () => {
    expect(canHaveClass({ ...ocrPaper, status: 'downloading' })).toMatchObject({ ok: false })
  })

  // Los agentes de la clase corrigen al profesor contra el texto: con el texto básico
  // (sin tablas ni fórmulas) evaluarían contra una versión recortada del paper.
  it('requires OCR first, with a code the UI can act on and a reason that says what to do', () => {
    const result = canHaveClass({ ...ocrPaper, pdf_text_source: 'pdf-parse' })

    expect(result).toMatchObject({ ok: false, code: 'ocr-required' })
    expect(result.reason).toMatch(/OCR/)
  })

  it('requires OCR even for papers saved before the OCR feature existed (null source)', () => {
    expect(canHaveClass({ ...ocrPaper, pdf_text_source: null })).toMatchObject({ ok: false, code: 'ocr-required' })
  })

  it('still reports a paper with OCR but no text at all', () => {
    const result = canHaveClass({ status: 'ready', pdf_text: '', abstract: '', pdf_text_source: 'ocr' })

    expect(result).toMatchObject({ ok: false })
    expect(result.code).toBeUndefined()
  })
})
