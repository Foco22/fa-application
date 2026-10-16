import { describe, it, expect } from 'vitest'
import { newPapersMessage, emptyFetchMessage } from '../../src/notifications.js'

describe('newPapersMessage', () => {
  it('pluraliza en español', () => {
    expect(newPapersMessage(1, 'es')).toBe('1 paper nuevo listo')
    expect(newPapersMessage(3, 'es')).toBe('3 papers nuevos listos')
  })

  it('pluraliza en inglés', () => {
    expect(newPapersMessage(1, 'en')).toBe('1 new paper ready')
    expect(newPapersMessage(3, 'en')).toBe('3 new papers ready')
  })

  it('cae a español si el idioma es desconocido o falta', () => {
    expect(newPapersMessage(2)).toBe('2 papers nuevos listos')
    expect(newPapersMessage(2, 'klingon')).toBe('2 papers nuevos listos')
  })
})
describe('emptyFetchMessage', () => {
  it('explica que ArXiv no devolvió candidatos', () => {
    expect(emptyFetchMessage({ code: 'no_candidates', candidates: 0 }, 'es')).toMatch(/ArXiv no devolvió/)
    expect(emptyFetchMessage({ code: 'no_candidates', candidates: 0 }, 'en')).toMatch(/ArXiv returned no papers/)
  })

  it('incluye la mejor similitud y el umbral cuando ningún paper pasó el filtro', () => {
    const out = { code: 'none_passed', candidates: 160, bestSimilarity: 0.455, threshold: 0.5 }

    const es = emptyFetchMessage(out, 'es')
    expect(es).toContain('160')
    expect(es).toContain('0.455')
    expect(es).toContain('0.50')
    expect(emptyFetchMessage(out, 'en')).toContain('0.455')
  })

  it('omite la similitud cuando no hubo embeddings', () => {
    const msg = emptyFetchMessage({ code: 'none_passed', candidates: 4, bestSimilarity: null, threshold: 0.5 }, 'es')

    expect(msg).toContain('4')
    expect(msg).not.toContain('null')
    expect(msg).not.toContain('NaN')
  })

  it('informa cuántos pasaron el filtro pero fallaron al descargar, con el primer error', () => {
    const msg = emptyFetchMessage({ code: 'downloads_failed', candidates: 5, survivors: 2, firstError: 'timeout' }, 'es')

    expect(msg).toContain('2')
    expect(msg).toContain('timeout')
  })

  it('cae a español si el idioma es desconocido', () => {
    expect(emptyFetchMessage({ code: 'no_candidates', candidates: 0 })).toMatch(/ArXiv no devolvió/)
  })
})
