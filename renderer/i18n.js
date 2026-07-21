import es from './i18n/es.js'
import en from './i18n/en.js'

export const DICTIONARIES = { es, en }
export const DEFAULT_LANGUAGE = 'es'

let current = DEFAULT_LANGUAGE

export function getLanguage() {
  return current
}

// Si falta la clave se devuelve la propia clave, no un string vacío: un hueco en
// el diccionario se ve como texto raro pero identificable, en vez de como un
// botón sin etiqueta.
export function t(key, lang = current) {
  const dict = DICTIONARIES[lang] || DICTIONARIES[DEFAULT_LANGUAGE]
  return dict[key] ?? DICTIONARIES[DEFAULT_LANGUAGE][key] ?? key
}

// Recorre el DOM y reescribe todo lo marcado. Es idempotente: se puede llamar
// las veces que sea (al arrancar, al guardar Settings) sin efectos acumulativos.
export function applyLanguage(lang, root = document) {
  current = DICTIONARIES[lang] ? lang : DEFAULT_LANGUAGE

  root.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n)
  })
  root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder)
  })
  root.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle)
  })

  if (root.documentElement) root.documentElement.lang = current
  return current
}
