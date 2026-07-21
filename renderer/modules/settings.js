import { CATEGORIES, CATEGORY_LABELS, DEFAULT_UNIVERSITIES, DEFAULT_RESEARCH_CENTERS, LLM_PROVIDERS, EMBEDDING_PROVIDERS, STT_PROVIDERS } from './constants.js'
import { toast } from './toast.js'
import { changeLanguage, t } from './language.js'

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

// Estado del índice de referencia tal como estaba al abrir Settings: sirve para
// avisar que hay que reindexar si el usuario cambia de motor de embeddings.
let indexedEmbeddingId = null
let referenceTotal     = 0

function currentEmbeddingId() {
  const provider = document.querySelector('.embedding-provider-btn.active')?.dataset.provider || 'openai'
  return `${provider}:${document.getElementById('s-embedding-model').value}`
}

// Los vectores de dos modelos distintos no comparten ni dimensión ni espacio:
// el índice viejo deja de servir para comparar en cuanto se cambia de motor.
function updateReindexWarning() {
  const stale = referenceTotal > 0 && indexedEmbeddingId !== null && currentEmbeddingId() !== indexedEmbeddingId
  document.getElementById('s-embedding-reindex-warning').classList.toggle('hidden', !stale)
}

export function setActiveEmbeddingProvider(provider) {
  const cfg = EMBEDDING_PROVIDERS[provider] || EMBEDDING_PROVIDERS.openai
  document.querySelectorAll('.embedding-provider-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.provider === provider)
  })
  const sel = document.getElementById('s-embedding-model')
  sel.innerHTML = cfg.models.map(m => `<option value="${m}">${m}</option>`).join('')

  // El proveedor local no usa API key — el campo se oculta en vez de quedar
  // pidiendo algo que no hace falta.
  document.getElementById('s-embedding-key-group').classList.toggle('hidden', !cfg.needsKey)
  document.getElementById('s-embedding-local-hint').classList.toggle('hidden', cfg.needsKey)

  // El umbral no se traslada entre motores: con el de OpenAI (0.6) el modelo
  // local rechazaría todos los papers.
  document.getElementById('s-threshold-hint').textContent =
    `Con este motor, un valor razonable es ~${cfg.suggestedThreshold}. La escala depende del modelo: no reutilices el umbral de otro proveedor.`

  updateReindexWarning()
}

// Cambiar de proveedor de Speech to Text siempre deja el modelo y el campo de
// API key en un estado válido para ese proveedor — nunca queda vacío ni con
// un modelo incompatible (ver features/settings-redesign.md, edge case).
export function updateSttProviderFields(provider) {
  const cfg = STT_PROVIDERS[provider] || STT_PROVIDERS.groq
  const modelGroup = document.getElementById('s-stt-model-group')
  const modelSel   = document.getElementById('s-stt-model')
  const keyGroup   = document.getElementById('s-stt-key-group')
  const keyLabel   = document.getElementById('s-stt-key-label')
  const keyInput   = document.getElementById('s-stt-api-key')

  if (cfg.models.length > 0) {
    modelGroup.classList.remove('hidden')
    modelSel.innerHTML = cfg.models.map(m => `<option value="${m}">${m}</option>`).join('')
  } else {
    modelGroup.classList.add('hidden')
    modelSel.innerHTML = ''
  }

  if (cfg.needsKey) {
    keyGroup.classList.remove('hidden')
    keyLabel.textContent = cfg.label
    keyInput.placeholder = cfg.placeholder
  } else {
    keyGroup.classList.add('hidden')
  }
}

function loadSttApiKeyForProvider(provider, settings) {
  const keyInput = document.getElementById('s-stt-api-key')
  if (provider === 'groq') keyInput.value = settings.groqApiKey || ''
  else if (provider === 'openai') keyInput.value = settings.openaiApiKey || ''
  else keyInput.value = ''
}

/* ── Navegación por categorías del sidebar ─────────────────────────────────
   Cambiar de categoría solo alterna qué panel se muestra — no se pierde
   ningún valor editado en otras categorías (todo vive en el DOM hasta
   t('guardar') o hasta cerrar el modal). */
export function switchSettingsCategory(categoryId) {
  document.querySelectorAll('.settings-cat-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.category === categoryId)
  })
  document.querySelectorAll('.settings-pane').forEach(pane => {
    pane.classList.toggle('hidden', pane.id !== `settings-pane-${categoryId}`)
  })
}

export async function openSettings() {
  const s = await window.api.getSettings()

  switchSettingsCategory('general')

  // General
  document.getElementById('s-language').value = s.language || 'es'
  window.api.getAppVersion().then(v => {
    document.getElementById('s-app-version').textContent = v ? `Versión ${v}` : t('version-no-disponible')
  }).catch(() => {
    document.getElementById('s-app-version').textContent = t('version-no-disponible')
  })

  // LLM
  const provider = s.llmProvider || 'openai'
  setActiveProvider(provider)
  document.getElementById('s-llm-model').value = s.llmModel || LLM_PROVIDERS[provider]?.models[0] || ''
  document.querySelectorAll('.provider-btn').forEach(btn => {
    btn.onclick = () => setActiveProvider(btn.dataset.provider)
  })
  document.getElementById('s-api-key').value = s.apiKey || ''

  // Embedding
  const embeddingProvider = s.embeddingProvider || 'openai'
  const embeddingModel    = s.embeddingModel || EMBEDDING_PROVIDERS[embeddingProvider]?.models[0] || ''
  indexedEmbeddingId = `${embeddingProvider}:${embeddingModel}`
  setActiveEmbeddingProvider(embeddingProvider)
  document.getElementById('s-embedding-model').value = embeddingModel
  document.getElementById('s-embedding-api-key').value = s.embeddingApiKey || ''
  document.querySelectorAll('.embedding-provider-btn').forEach(btn => {
    btn.onclick = () => setActiveEmbeddingProvider(btn.dataset.provider)
  })
  document.getElementById('s-embedding-model').onchange = updateReindexWarning

  // Speech to Text — "webspeech" ya no existe como opción: si el usuario lo
  // tenía guardado de antes, cae a Groq sin key precargada (ver PRD, edge case).
  const savedSttProvider = s.transcriptionProvider
  const sttProvider = STT_PROVIDERS[savedSttProvider] ? savedSttProvider : 'groq'
  document.getElementById('s-transcription-provider').value = sttProvider
  updateSttProviderFields(sttProvider)
  if (STT_PROVIDERS[savedSttProvider]) loadSttApiKeyForProvider(sttProvider, s)
  document.getElementById('s-stt-model').value = s.sttModel || STT_PROVIDERS[sttProvider]?.models[0] || ''
  document.getElementById('s-transcription-provider').onchange = (e) => {
    const p = e.target.value
    updateSttProviderFields(p)
    loadSttApiKeyForProvider(p, s)
  }

  // Ingesta
  document.getElementById('s-ss-key').value       = s.semanticScholarApiKey || ''
  document.getElementById('s-universities').value = s.universityList || DEFAULT_UNIVERSITIES.join('\n')
  document.getElementById('s-research-centers').value = s.researchCenterList || DEFAULT_RESEARCH_CENTERS.join('\n')
  document.getElementById('s-authors').value   = s.authorList || ''
  document.getElementById('s-keywords').value  = s.keywordList || ''
  document.getElementById('s-fetch-day').value  = s.fetchDay  || 'monday'
  document.getElementById('s-fetch-hour').value = s.fetchHour || '09:00'
  document.getElementById('s-max-papers').value = s.maxPapers || '3'
  const selected = (s.categoryList || '').split(',').map(x => x.trim()).filter(Boolean)
  buildCategoriesGrid('s-categories-grid', selected)

  // Papers de referencia
  document.getElementById('s-ref-folder').value            = s.referenceFolderPath || ''
  document.getElementById('s-similarity-threshold').value  = s.similarityThreshold || '0.6'
  window.api.getReferenceStats().then(({ total, stale }) => {
    referenceTotal = total
    const base = `${total} paper${total !== 1 ? 's' : ''} indexado${total !== 1 ? 's' : ''}`
    // `stale` = indexados con otro motor de embeddings; no cuentan para el filtro
    // de similitud hasta que se reindexen.
    document.getElementById('s-ref-stats').textContent = stale > 0
      ? `${base} — ${stale} con un motor de embeddings distinto (reindexar para usarlos)`
      : base
    updateReindexWarning()
  })

  document.getElementById('settings-panel').classList.remove('hidden')
}

export async function saveSettings() {
  const activeBtn          = document.querySelector('.provider-btn.active')
  const activeEmbeddingBtn = document.querySelector('.embedding-provider-btn.active')
  const sttProvider        = document.getElementById('s-transcription-provider').value

  const settings = {
    language:              document.getElementById('s-language').value,

    llmProvider:           activeBtn?.dataset.provider || 'openai',
    llmModel:              document.getElementById('s-llm-model').value,
    apiKey:                document.getElementById('s-api-key').value.trim(),

    embeddingProvider:     activeEmbeddingBtn?.dataset.provider || 'openai',
    embeddingModel:        document.getElementById('s-embedding-model').value,
    embeddingApiKey:       document.getElementById('s-embedding-api-key').value.trim(),

    transcriptionProvider: sttProvider,
    sttModel:              document.getElementById('s-stt-model').value,

    semanticScholarApiKey: document.getElementById('s-ss-key').value.trim(),
    fetchDay:              document.getElementById('s-fetch-day').value,
    fetchHour:             document.getElementById('s-fetch-hour').value,
    maxPapers:             document.getElementById('s-max-papers').value,
    universityList:        document.getElementById('s-universities').value,
    researchCenterList:    document.getElementById('s-research-centers').value,
    authorList:            document.getElementById('s-authors').value,
    keywordList:           document.getElementById('s-keywords').value,
    categoryList:          getSelectedCategories('s-categories-grid').join(','),
    referenceFolderPath:   document.getElementById('s-ref-folder').value,
    similarityThreshold:   document.getElementById('s-similarity-threshold').value || '0.6',
  }

  const sttKey = document.getElementById('s-stt-api-key').value.trim()
  if (sttProvider === 'groq')   settings.groqApiKey   = sttKey
  if (sttProvider === 'openai') settings.openaiApiKey = sttKey

  await window.api.saveSettings(settings)
  document.getElementById('settings-panel').classList.add('hidden')

  // Se aplica después de guardar, no al tocar el selector: el idioma efectivo es
  // siempre el que quedó persistido — el mismo que leen las notificaciones del
  // proceso main —, nunca un valor pendiente en el formulario.
  await changeLanguage(settings.language)

  toast(t('configuracion-guardada'), 'success')
}
