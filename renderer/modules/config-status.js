import { t } from './language.js'

// Misma condición que ya usa runFetch() para el aviso reactivo
// ("Configura al menos un tema o autor en Settings") — esta es la versión
// proactiva: se muestra antes de que el usuario intente el fetch y falle.
// Además exige API key, porque sin ella tampoco hay resumen/quiz posibles.
export function needsConfiguration(settings = {}) {
  const noTopicsOrAuthors = !(settings.categoryList || '').trim() && !(settings.authorList || '').trim()
  const noApiKey = !(settings.apiKey || '').trim()
  return noTopicsOrAuthors || noApiKey
}

export function updateConfigIndicator(settings) {
  const dot = document.getElementById('settings-pending-dot')
  if (!dot) return
  const pending = needsConfiguration(settings)
  dot.classList.toggle('hidden', !pending)
  dot.title = pending ? t('config-pendiente-tooltip') : ''
}
