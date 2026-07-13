import { DEFAULT_UNIVERSITIES, DEFAULT_RESEARCH_CENTERS } from './constants.js'
import { buildCategoriesGrid, getSelectedCategories } from './settings.js'
import { t } from './language.js'

let _showApp = () => {}

export function initOnboarding({ showApp }) {
  _showApp = showApp
}

let wizStep = 1

export function showOnboarding() {
  document.getElementById('onboarding').classList.remove('hidden')
  document.getElementById('app').classList.add('hidden')
  buildCategoriesGrid('categories-grid', [])
  buildUniversitiesGrid()
  goWizStep(1)
}

function buildUniversitiesGrid() {
  const grid = document.getElementById('universities-grid')
  if (!grid) return
  grid.innerHTML = ''
  DEFAULT_UNIVERSITIES.forEach(u => {
    const label = document.createElement('label')
    const cb    = document.createElement('input')
    cb.type = 'checkbox'; cb.value = u; cb.checked = true
    label.appendChild(cb)
    label.appendChild(document.createTextNode(' ' + u))
    grid.appendChild(label)
  })
}

export function goWizStep(n) {
  wizStep = n
  for (let i = 1; i <= 4; i++) {
    document.getElementById(`step-${i}`).classList.toggle('hidden', i !== n)
    const dot = document.querySelector(`.step-dot[data-step="${i}"]`)
    dot.classList.remove('active', 'done')
    if (i < n)        dot.classList.add('done')
    else if (i === n) dot.classList.add('active')
  }
}

export async function finishOnboarding() {
  const apiKey = document.getElementById('wiz-api-key').value.trim()
  if (!apiKey) {
    document.getElementById('step4-error').classList.remove('hidden')
    return
  }
  document.getElementById('step4-error').classList.add('hidden')

  const settings = {
    apiKey,
    categoryList:      getSelectedCategories('categories-grid').join(','),
    universityList:    Array.from(
      document.querySelectorAll('#universities-grid input:checked')
    ).map(cb => cb.value).join('\n'),
    researchCenterList: DEFAULT_RESEARCH_CENTERS.join('\n'),
    authorList:  document.getElementById('author-input').value,
    fetchDay:    document.getElementById('wiz-fetch-day').value,
    fetchHour:   document.getElementById('wiz-fetch-hour').value,
    maxPapers:   document.getElementById('wiz-max-papers').value,
    onboardingDone: 'true',
  }

  const btn = document.getElementById('step4-finish')
  btn.disabled = true; btn.textContent = t('configurando')
  await window.api.completeOnboarding(settings)
  await _showApp()
  btn.disabled = false; btn.textContent = t('comenzar')
}

// Onboarding step navigation wiring (ejecutado al cargar el módulo, DOM ya listo por defer de módulos ES)
document.getElementById('step1-next').addEventListener('click', () => {
  const cats = getSelectedCategories('categories-grid')
  if (cats.length === 0) {
    document.getElementById('step1-error').classList.remove('hidden')
    return
  }
  document.getElementById('step1-error').classList.add('hidden')
  goWizStep(2)
})
document.getElementById('step2-back').addEventListener('click', () => goWizStep(1))
document.getElementById('step2-next').addEventListener('click', () => goWizStep(3))
document.getElementById('step3-back').addEventListener('click', () => goWizStep(2))
document.getElementById('step3-next').addEventListener('click', () => goWizStep(4))
document.getElementById('step4-back').addEventListener('click', () => goWizStep(3))
document.getElementById('step4-finish').addEventListener('click', finishOnboarding)
