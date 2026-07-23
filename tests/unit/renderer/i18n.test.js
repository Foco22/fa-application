// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { t, applyLanguage, getLanguage, DICTIONARIES, DEFAULT_LANGUAGE } from '../../../renderer/i18n.js'
import es from '../../../renderer/i18n/es.js'
import en from '../../../renderer/i18n/en.js'

// ─── cobertura de claves ──────────────────────────────────────────────────────

describe('diccionarios', () => {
  // La métrica del PRD: si una clave existe en un idioma y no en el otro, ese
  // texto queda sin traducir en la UI. El test lo hace imposible de pasar por alto.
  it('es y en tienen exactamente el mismo set de claves', () => {
    const esKeys = Object.keys(es).sort()
    const enKeys = Object.keys(en).sort()

    expect(enKeys.filter(k => !(k in es))).toEqual([])   // sobra en inglés
    expect(esKeys.filter(k => !(k in en))).toEqual([])   // falta en inglés
    expect(enKeys).toEqual(esKeys)
  })

  it('ninguna traducción está vacía', () => {
    for (const [key, value] of Object.entries(en)) {
      expect(value, `en.${key} está vacío`).toBeTruthy()
    }
  })

  // Cada data-i18n del HTML tiene que existir en el diccionario, si no el texto
  // se reemplazaría por la clave cruda al aplicar el idioma.
  it('toda clave usada en index.html existe en los diccionarios', () => {
    const html = fs.readFileSync(path.resolve('renderer/index.html'), 'utf-8')
    const used = [...html.matchAll(/data-i18n(?:-placeholder|-title)?="([^"]+)"/g)].map(m => m[1])

    expect(used.length).toBeGreaterThan(100)
    const missing = [...new Set(used)].filter(k => !(k in es))
    expect(missing).toEqual([])
  })
})

// ─── t() ──────────────────────────────────────────────────────────────────────

describe('t', () => {
  beforeEach(() => applyLanguage('es'))

  it('traduce en el idioma activo', () => {
    expect(t('guardar')).toBe('Guardar')
    applyLanguage('en')
    expect(t('guardar')).toBe('Save')
  })

  it('acepta un idioma explícito sin cambiar el activo', () => {
    expect(t('guardar', 'en')).toBe('Save')
    expect(getLanguage()).toBe('es')
  })

  // Un hueco en el diccionario tiene que verse, no romper la UI dejando un botón
  // sin etiqueta.
  it('devuelve la clave cuando no existe la traducción', () => {
    expect(t('clave-que-no-existe')).toBe('clave-que-no-existe')
  })

  // El default del sistema es inglés, no español (ver features/first-run-profile.md).
  it('cae al inglés si el idioma pedido no existe', () => {
    expect(t('guardar', 'klingon')).toBe('Save')
  })
})

// ─── applyLanguage ────────────────────────────────────────────────────────────

describe('applyLanguage', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button data-i18n="guardar">Guardar</button>
      <span data-i18n="costos">Costos</span>
      <input data-i18n-placeholder="escribe-tu-pregunta">
      <button data-i18n-title="ampliar-pdf"></button>
    `
    applyLanguage('es')
  })

  it('traduce texto, placeholders y titles', () => {
    applyLanguage('en')

    expect(document.querySelector('[data-i18n="guardar"]').textContent).toBe('Save')
    expect(document.querySelector('[data-i18n="costos"]').textContent).toBe('Costs')
    expect(document.querySelector('input').placeholder).toBe('Type your question...')
    expect(document.querySelector('[data-i18n-title]').title).toBe('Expand file')
  })

  it('vuelve al español sin dejar texto en el idioma anterior', () => {
    applyLanguage('en')
    applyLanguage('es')
    expect(document.querySelector('[data-i18n="guardar"]').textContent).toBe('Guardar')
  })

  // Se invoca al arrancar y en cada guardado de Settings: llamarla dos veces no
  // puede duplicar ni acumular nada.
  it('es idempotente', () => {
    applyLanguage('en')
    const once = document.body.innerHTML
    applyLanguage('en')
    expect(document.body.innerHTML).toBe(once)
  })

  it('cae al idioma de fábrica (inglés) si le pasan uno desconocido', () => {
    expect(applyLanguage('klingon')).toBe(DEFAULT_LANGUAGE)
    expect(DEFAULT_LANGUAGE).toBe('en')
    expect(document.querySelector('[data-i18n="guardar"]').textContent).toBe('Save')
  })

  it('marca el idioma en el <html> para que lo vean CSS y lectores de pantalla', () => {
    applyLanguage('en')
    expect(document.documentElement.lang).toBe('en')
  })

  it('expone ambos idiomas y ninguno más', () => {
    expect(Object.keys(DICTIONARIES).sort()).toEqual(['en', 'es'])
  })
})