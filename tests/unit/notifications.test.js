import { describe, it, expect } from 'vitest'
import { newPapersMessage } from '../../src/notifications.js'

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