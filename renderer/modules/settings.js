import { CATEGORIES, CATEGORY_LABELS, DEFAULT_UNIVERSITIES, DEFAULT_RESEARCH_CENTERS, LLM_PROVIDERS } from './constants.js'
import { toast } from './toast.js'

export function buildCategoriesGrid(containerId, selectedList) {
  const container = document.getElementById(containerId)
  if (!container) return
  container.innerHTML = ''

  CATEGORIES.forEach(group => {
    const div = document.createElement('div')
    div.className = 'category-group'
    const h4 = document.createElement('h4')
    h4.textContent = group.group
    div.appendChild(h4)
    group.items.forEach(cat => {
      const label = document.createElement('label')
      const fullName = CATEGORY_LABELS[cat]
      if (fullName) label.dataset.tooltip = fullName
      const cb = document.createElement('input')
      cb.type = 'checkbox'; cb.value = cat; cb.checked = selectedList.includes(cat)
      label.appendChild(cb)
      label.appendChild(document.createTextNode(' ' + cat))
      div.appendChild(label)
    })
    container.appendChild(div)
  })
}

export function getSelectedCategories(containerId) {
  return Array.from(
    document.querySelectorAll(`#${containerId} input[type="checkbox"]:checked`)
  ).map(cb => cb.value)
}

export function setActiveProvider(provider) {
  const cfg = LLM_PROVIDERS[provider] || LLM_PROVIDERS.openai
  document.querySelectorAll('.provider-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.provider === provider)
  })
  document.getElementById('s-api-key-label').textContent = cfg.label
  document.getElementById('s-api-key').placeholder = cfg.placeholder
  const sel = document.getElementById('s-llm-model')
  sel.innerHTML = cfg.models.map(m => `<option value="${m}">${m}</option>`).join('')
}

export function setActiveClassProvider(provider) {
  const cfg = LLM_PROVIDERS[provider] || LLM_PROVIDERS.deepseek
  document.querySelectorAll('.class-provider-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.provider === provider)
  })
  const sel = document.getElementById('s-class-llm-model')
  sel.innerHTML = cfg.models.map(m => `<option value="${m}">${m}</option>`).join('')
}

export async function openSettings() {
  const s = await window.api.getSettings()

  const provider = s.llmProvider || 'openai'
  setActiveProvider(provider)
  document.getElementById('s-llm-model').value = s.llmModel || LLM_PROVIDERS[provider]?.models[0] || ''

  document.querySelectorAll('.provider-btn').forEach(btn => {
    btn.onclick = () => setActiveProvider(btn.dataset.provider)
  })

  const classProvider = s.classLlmProvider || 'deepseek'
  setActiveClassProvider(classProvider)
  document.getElementById('s-class-llm-model').value = s.classLlmModel || LLM_PROVIDERS[classProvider]?.models[0] || 'deepseek-v4-flash'
  document.getElementById('s-class-api-key').value   = s.classApiKey || ''

  document.querySelectorAll('.class-provider-btn').forEach(btn => {
    btn.onclick = () => setActiveClassProvider(btn.dataset.provider)
  })

  document.getElementById('s-api-key').value   = s.apiKey || ''
  document.getElementById('s-ss-key').value    = s.semanticScholarApiKey || ''
  document.getElementById('s-universities').value = s.universityList || DEFAULT_UNIVERSITIES.join('\n')
  document.getElementById('s-research-centers').value = s.researchCenterList || DEFAULT_RESEARCH_CENTERS.join('\n')
  document.getElementById('s-authors').value   = s.authorList || ''
  document.getElementById('s-fetch-day').value  = s.fetchDay  || 'monday'
  document.getElementById('s-fetch-hour').value = s.fetchHour || '09:00'
  document.getElementById('s-max-papers').value = s.maxPapers || '3'

  document.getElementById('s-transcription-provider').value = s.transcriptionProvider || 'whisper'

  document.getElementById('s-ref-folder').value            = s.referenceFolderPath || ''
  document.getElementById('s-similarity-threshold').value  = s.similarityThreshold || '0.72'

  const selected = (s.categoryList || '').split(',').map(x => x.trim()).filter(Boolean)
  buildCategoriesGrid('s-categories-grid', selected)

  window.api.getReferenceStats().then(({ total }) => {
    document.getElementById('s-ref-stats').textContent = `${total} paper${total !== 1 ? 's' : ''} indexado${total !== 1 ? 's' : ''}`
  })

  document.getElementById('settings-panel').classList.remove('hidden')
}

export async function saveSettings() {
  const activeBtn      = document.querySelector('.provider-btn.active')
  const activeClassBtn = document.querySelector('.class-provider-btn.active')
  const settings = {
    llmProvider:           activeBtn?.dataset.provider || 'openai',
    llmModel:              document.getElementById('s-llm-model').value,
    apiKey:                document.getElementById('s-api-key').value.trim(),
    classLlmProvider:      activeClassBtn?.dataset.provider || 'deepseek',
    classLlmModel:         document.getElementById('s-class-llm-model').value,
    classApiKey:           document.getElementById('s-class-api-key').value.trim(),
    semanticScholarApiKey: document.getElementById('s-ss-key').value.trim(),
    fetchDay:              document.getElementById('s-fetch-day').value,
    fetchHour:             document.getElementById('s-fetch-hour').value,
    maxPapers:             document.getElementById('s-max-papers').value,
    universityList:        document.getElementById('s-universities').value,
    researchCenterList:    document.getElementById('s-research-centers').value,
    authorList:            document.getElementById('s-authors').value,
    categoryList:          getSelectedCategories('s-categories-grid').join(','),
    transcriptionProvider: document.getElementById('s-transcription-provider').value,
    referenceFolderPath:   document.getElementById('s-ref-folder').value,
    similarityThreshold:   document.getElementById('s-similarity-threshold').value || '0.72',
  }
  await window.api.saveSettings(settings)
  document.getElementById('settings-panel').classList.add('hidden')
  toast('Configuración guardada', 'success')
}
