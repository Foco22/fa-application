import { t } from './language.js'
import { startStarfield } from './starfield.js'

let _showApp = () => {}

export function initOnboarding({ showApp }) {
  _showApp = showApp
}

let stopBackground = () => {}

export function showOnboarding() {
  document.getElementById('onboarding').classList.remove('hidden')
  document.getElementById('app').classList.add('hidden')
  document.getElementById('welcome-name-error').classList.add('hidden')
  document.getElementById('welcome-name').value = ''
  stopBackground = startStarfield(document.getElementById('welcome-canvas'))
  document.getElementById('welcome-name').focus()
}

export async function finishOnboarding() {
  const input = document.getElementById('welcome-name')
  const userName = input.value.trim()
  if (!userName) {
    document.getElementById('welcome-name-error').classList.remove('hidden')
    return
  }
  document.getElementById('welcome-name-error').classList.add('hidden')

  const btn = document.getElementById('welcome-accept')
  btn.disabled = true
  btn.textContent = t('guardando')
  await window.api.completeOnboarding({ userName })
  stopBackground()
  await _showApp()
  btn.disabled = false
  btn.textContent = t('aceptar')
}

// Wiring ejecutado al cargar el módulo (DOM ya listo por defer de módulos ES).
document.getElementById('welcome-accept').addEventListener('click', finishOnboarding)
document.getElementById('welcome-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') finishOnboarding()
})
