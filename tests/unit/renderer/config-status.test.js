import { describe, it, expect } from 'vitest'
import { needsConfiguration } from '../../../renderer/modules/config-status.js'

describe('needsConfiguration', () => {
  it('falta configuración si no hay categorías, autores ni API key', () => {
    expect(needsConfiguration({})).toBe(true)
  })

  it('falta configuración si hay API key pero ni categorías ni autores', () => {
    expect(needsConfiguration({ apiKey: 'sk-ant-test' })).toBe(true)
  })

  it('falta configuración si hay categorías/autores pero no API key', () => {
    expect(needsConfiguration({ categoryList: 'cs.AI', apiKey: '' })).toBe(true)
  })

  it('no falta nada si hay categorías y API key', () => {
    expect(needsConfiguration({ categoryList: 'cs.AI', apiKey: 'sk-ant-test' })).toBe(false)
  })

  it('autores solos (sin categorías) también cuentan como suficiente', () => {
    expect(needsConfiguration({ authorList: 'LeCun', apiKey: 'sk-ant-test' })).toBe(false)
  })

  it('categorías/autores en blanco (solo espacios) cuentan como vacíos', () => {
    expect(needsConfiguration({ categoryList: '   ', authorList: '  ', apiKey: 'sk-ant-test' })).toBe(true)
  })
})
