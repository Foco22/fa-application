import { toast } from './toast.js'
import { LLM_PROVIDERS } from './constants.js'

// ── Module state ─────────────────────────────────────────────────────────────
let _paper = null
let _sessionId = null
let _selectedDuration = 180
let _slides = []          // prep slides: [{ imageData, mimeType, previewUrl }]
let _dbSlides = []        // slides from DB after session creation
let _currentSlideIndex = 0
let _timer = null
let _webcamStream = null
let _transcript = ''
let _professorBubble = null  // burbuja activa del profesor en el chat de la clase

let _prepSlideIndex = 0

let _mediaRecorder = null
let _transcribeInterval = null
let _vadPoll = null
let _audioCtx = null
let _pendingBatchAudio = null
let _speechRecognition = null
let _recognitionActive = false
let _usingWhisperLocal = false
let _classLanguage = 'es'
let _classModel = 'whisper-large-v3-turbo'
let _localModel = 'small'
let _transcriptionBackend = 'groq'
let _prepLlmProvider = 'deepseek'
let _prepLlmModel = 'deepseek-v4-flash'

// Q&A state
let _qaStudentIndex = 0
let _qaHistory = []       // [{question, answer}] for current student's exchanges
let _qaLog = []           // completed exchanges per student
let _qaExchangeCount = 0
let _qaActive = false

// Progressive hint state
let _hintLevel = 0         // 0=none, 1=bell shown, 2=guidance shown, 3=answer shown
let _pendingMissing = null // 'missing' field from last failed evaluation
let _cachedHintResult = null // cached LLM result — one call per student turn, reused on re-open

// Assistant chat state
let _assistantHistory  = []   // [{role, content}] for the assistant chat
let _assistantExcerpts = []   // paper excerpts used as context
let _assistantMissing  = null // what the professor is missing
let _assistantCanReveal = false // true when Round 4 is reached

// PDF hints viewer state
let _pdfHintsDoc      = null  // loaded pdfjsLib document
let _pdfHintsExcerpts = []    // current excerpts to highlight
let _pdfHintsScale    = 1.2   // current zoom scale
const PDF_ZOOM_STEP = 0.3
const PDF_ZOOM_MIN  = 0.7
const PDF_ZOOM_MAX  = 4.0

const STUDENTS = [
  { id: 1, name: 'María',  initials: 'MG', color: '#6366f1' },
  { id: 2, name: 'Carlos', initials: 'CR', color: '#10b981' },
  { id: 3, name: 'Sofía',  initials: 'SK', color: '#f59e0b' },
]

// ── Session reset ─────────────────────────────────────────────────────────────

function clearSessionState() {
  // Stop any in-progress media
  _timer?.stop()
  _timer = null
  stopSpeechRecognition()
  stopWebcam()

  // Reset all state variables
  _sessionId         = null
  _selectedDuration  = 180
  _slides            = []
  _dbSlides          = []
  _currentSlideIndex = 0
  _transcript        = ''
  _professorBubble   = null
  _pendingBatchAudio = null
  _prepSlideIndex    = 0
  _qaStudentIndex    = 0
  _qaHistory         = []
  _qaLog             = []
  _qaExchangeCount   = 0
  _qaActive          = false
  _hintLevel         = 0
  _pendingMissing    = null
  _cachedHintResult  = null
  _assistantHistory  = []
  _assistantExcerpts = []
  _assistantMissing  = null
  _assistantCanReveal = false
  _pdfHintsDoc       = null
  _pdfHintsExcerpts  = []
  _pdfHintsScale     = 1.2

  // Clear DOM
  const qaMsg = document.getElementById('class-qa-messages')
  if (qaMsg) qaMsg.innerHTML = ''
  const asstMsg = document.getElementById('class-qa-assistant-messages')
  if (asstMsg) asstMsg.innerHTML = ''
  const tableBody = document.getElementById('class-qa-table-body')
  if (tableBody) tableBody.innerHTML = ''

  // Reset score display
  const scoreIds = ['class-score-final-num', 'class-score-pres-num', 'class-score-qa-num']
  scoreIds.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '—' })
  const presFields = ['class-pres-feedback', 'class-pres-strengths', 'class-pres-improvements']
  presFields.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '' })

  // Remove hint overlays
  document.getElementById('class-hint-bell-overlay')?.remove()
  document.getElementById('class-hint-assistant-overlay')?.remove()

  // Hide auxiliary panels
  document.getElementById('class-qa-assistant-panel')?.classList.add('hidden')
  document.getElementById('class-qa-pdf-hints')?.classList.add('hidden')

  // Reset timer display
  const timerEl = document.getElementById('class-timer-display')
  if (timerEl) timerEl.textContent = '3:00'

  // Deselect all participants
  document.querySelectorAll('[data-student]').forEach(t => t.classList.remove('speaking', 'active'))

  // Remove any webcam-fallback avatar injected into the self tile
  const selfTile = document.getElementById('class-tile-self')
  if (selfTile) {
    selfTile.querySelectorAll('.class-tile-avatar').forEach(el => el.remove())
    const vid = selfTile.querySelector('video')
    if (vid) vid.style.display = ''
  }

  enableChatInput(false)
}

// ── Public API ────────────────────────────────────────────────────────────────

function updatePrepLlmModels(provider) {
  const sel = document.getElementById('class-prep-llm-model')
  if (!sel) return
  const models = LLM_PROVIDERS[provider]?.models || []
  sel.innerHTML = models.map(m => `<option value="${m}">${m}</option>`).join('')
}

function updateModelSelectVisibility(backend) {
  const showGroq   = backend === 'groq'
  const showOpenAI = backend === 'whisper'
  const showLocal  = backend === 'whisper-local'
  const el = (id) => document.getElementById(id)
  if (el('class-groq-model-label'))   el('class-groq-model-label').style.display   = showGroq   ? '' : 'none'
  if (el('class-groq-model-select'))  el('class-groq-model-select').style.display  = showGroq   ? '' : 'none'
  if (el('class-model-select-label')) el('class-model-select-label').style.display = showOpenAI ? '' : 'none'
  if (el('class-model-select'))       el('class-model-select').style.display       = showOpenAI ? '' : 'none'
  if (el('class-local-model-label'))  el('class-local-model-label').style.display  = showLocal  ? '' : 'none'
  if (el('class-local-model-select')) el('class-local-model-select').style.display = showLocal  ? '' : 'none'
}

export function enterClassMode(paper) {
  clearSessionState()
  _paper = paper

  document.getElementById('vault-panel').classList.add('hidden')
  document.getElementById('content-panel').classList.add('hidden')
  document.getElementById('chat-panel').classList.add('hidden')
  document.getElementById('class-fullscreen').classList.remove('hidden')

  document.getElementById('class-paper-title').textContent = paper.title || paper.id
  renderSlidesGrid()
  resetUI()
  showView('prep')

  // Pre-populate selectors from saved settings
  window.api.getSettings().then(s => {
    const backendSel = document.getElementById('class-transcription-backend-select')
    if (backendSel) {
      backendSel.value = s.transcriptionProvider || 'groq'
      updateModelSelectVisibility(backendSel.value)
    }
    const llmSel = document.getElementById('class-prep-llm-provider')
    if (llmSel) {
      llmSel.value = s.classLlmProvider || 'deepseek'
      updatePrepLlmModels(llmSel.value)
      const modelSel = document.getElementById('class-prep-llm-model')
      if (modelSel && s.classLlmModel) modelSel.value = s.classLlmModel
    }
  }).catch(() => {})
}

export function exitClassMode() {
  clearSessionState()
  document.getElementById('class-fullscreen').classList.add('hidden')
  document.getElementById('vault-panel').classList.remove('hidden')
  document.getElementById('content-panel').classList.remove('hidden')
  document.getElementById('chat-panel').classList.remove('hidden')
}

async function toggleQaPdf() {
  const pdfView    = document.getElementById('class-qa-pdf-view')
  const spotlight  = document.getElementById('class-qa-spotlight')
  const btn        = document.getElementById('class-btn-toggle-notes')
  const isOpen     = !pdfView.classList.contains('hidden')

  if (isOpen) {
    pdfView.classList.add('hidden')
    spotlight.classList.remove('hidden')
    btn.classList.remove('active')
  } else {
    if (!pdfView.dataset.loaded && _paper) {
      const url = await window.api.getPdfUrl(_paper.id)
      if (url) { pdfView.data = url; pdfView.dataset.loaded = '1' }
    }
    pdfView.classList.remove('hidden')
    spotlight.classList.add('hidden')
    btn.classList.add('active')
  }
}

export function showView(name) {
  document.querySelectorAll('#class-main-area .class-view').forEach(v => v.classList.add('hidden'))
  const el = document.getElementById(`class-view-${name}`)
  if (el) el.classList.remove('hidden')

  // Sidebars visible only during active class (not prep/loading/results)
  const withSidebars = name === 'active' || name === 'qa'
  document.getElementById('class-sidebar-participants').classList.toggle('hidden', !withSidebars)
  document.getElementById('class-sidebar-chat').classList.toggle('hidden', !withSidebars)
  document.getElementById('class-qa-assistant-panel')?.classList.add('hidden')

  // Chat input: only enabled during Q&A (managed by enableChatInput — default to disabled here)
  if (name !== 'qa') {
    const chatInput = document.getElementById('class-qa-input')
    const chatSend  = document.getElementById('class-qa-send')
    if (chatInput) chatInput.disabled = true
    if (chatSend)  chatSend.disabled  = true
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

function showExitConfirm() {
  document.getElementById('class-exit-overlay').classList.remove('hidden')
}

function hideExitConfirm() {
  document.getElementById('class-exit-overlay').classList.add('hidden')
}

export function initClass() {
  document.getElementById('class-btn-done')?.addEventListener('click', exitClassMode)

  // Exit confirm modal
  document.getElementById('class-exit-cancel').addEventListener('click', hideExitConfirm)
  document.getElementById('class-exit-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) hideExitConfirm()
  })
  document.getElementById('class-exit-ok').addEventListener('click', () => {
    hideExitConfirm()
    exitClassMode()
  })
  document.getElementById('class-btn-exit-prep').addEventListener('click', showExitConfirm)
  document.getElementById('class-btn-exit-active').addEventListener('click', showExitConfirm)
  document.getElementById('class-btn-exit-qa').addEventListener('click', showExitConfirm)

  attachVoiceButton({
    micBtnId: 'class-qa-voice', sendBtnId: 'class-qa-send',
    cancelBtnId: 'class-qa-voice-cancel', confirmBtnId: 'class-qa-voice-confirm',
    textareaId: 'class-qa-input', waveformId: 'qa-waveform',
    sendFn: sendQAResponse
  })
  attachVoiceButton({
    micBtnId: 'class-qa-assistant-voice', sendBtnId: 'class-qa-assistant-send',
    cancelBtnId: 'class-qa-assistant-voice-cancel', confirmBtnId: 'class-qa-assistant-voice-confirm',
    textareaId: 'class-qa-assistant-input', waveformId: 'assistant-waveform',
    sendFn: sendAssistantMessage
  })

  document.getElementById('class-btn-toggle-notes').addEventListener('click', toggleQaPdf)
  document.getElementById('class-qa-pdf-hints-close').addEventListener('click', closePdfHints)
  document.getElementById('class-qa-assistant-close').addEventListener('click', closeAssistantPanel)
  document.getElementById('class-qa-assistant-send').addEventListener('click', sendAssistantMessage)
  document.getElementById('class-qa-assistant-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAssistantMessage() }
  })

  // Drag-to-resize chat sidebar (left edge)
  const chatResizeHandle = document.getElementById('class-sidebar-chat-resize')
  const chatSidebar = document.getElementById('class-sidebar-chat')
  chatResizeHandle?.addEventListener('mousedown', e => {
    const startX = e.clientX
    const startW = chatSidebar.offsetWidth
    chatResizeHandle.classList.add('dragging')
    const onMove = ev => {
      const delta = startX - ev.clientX  // drag left = sidebar grows
      const newW  = Math.max(240, Math.min(600, startW + delta))
      chatSidebar.style.width = newW + 'px'
    }
    const onUp = () => {
      chatResizeHandle.classList.remove('dragging')
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    e.preventDefault()
  })

  // Drag-to-resize assistant panel
  const resizeHandle = document.getElementById('class-qa-assistant-resize')
  const assistantPanel = document.getElementById('class-qa-assistant-panel')
  resizeHandle?.addEventListener('mousedown', e => {
    const startX = e.clientX
    const startW = assistantPanel.offsetWidth
    resizeHandle.classList.add('dragging')
    const onMove = ev => {
      const delta = startX - ev.clientX  // dragging left = panel grows
      const newW  = Math.max(200, Math.min(600, startW + delta))
      assistantPanel.style.width = newW + 'px'
    }
    const onUp = () => {
      resizeHandle.classList.remove('dragging')
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    e.preventDefault()
  })

  document.getElementById('class-pdf-zoom-in').addEventListener('click', async () => {
    if (_pdfHintsScale < PDF_ZOOM_MAX) {
      _pdfHintsScale = Math.min(PDF_ZOOM_MAX, parseFloat((_pdfHintsScale + PDF_ZOOM_STEP).toFixed(2)))
      await renderPdfHintsPages()
    }
  })

  document.getElementById('class-pdf-zoom-out').addEventListener('click', async () => {
    if (_pdfHintsScale > PDF_ZOOM_MIN) {
      _pdfHintsScale = Math.max(PDF_ZOOM_MIN, parseFloat((_pdfHintsScale - PDF_ZOOM_STEP).toFixed(2)))
      await renderPdfHintsPages()
    }
  })

  document.getElementById('class-transcription-backend-select')?.addEventListener('change', (e) => {
    updateModelSelectVisibility(e.target.value)
  })

  document.getElementById('class-prep-llm-provider')?.addEventListener('change', (e) => {
    updatePrepLlmModels(e.target.value)
  })

  document.getElementById('class-file-input').addEventListener('change', onFileChange)
  const triggerFileInput = (e) => {
    if (e) e.stopPropagation()
    const fi = document.getElementById('class-file-input')
    fi.value = ''
    fi.click()
  }
  document.getElementById('class-btn-add-slide').addEventListener('click', triggerFileInput)
  document.getElementById('class-btn-add-slide-more').addEventListener('click', triggerFileInput)
  document.getElementById('class-btn-add-slide-overlay').addEventListener('click', triggerFileInput)
  document.getElementById('class-slides-dropzone').addEventListener('click', (e) => {
    if (_slides.length >= 3) return
    if (e.target.closest('button') || e.target.closest('img')) return
    triggerFileInput()
  })

  document.querySelectorAll('.duration-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.duration-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      _selectedDuration = parseInt(btn.dataset.duration, 10)
    })
  })

  document.getElementById('class-btn-start').addEventListener('click', startClass)

  // Prep slide viewer controls
  document.getElementById('class-slide-viewer-prev').addEventListener('click', () => {
    if (_prepSlideIndex > 0) { _prepSlideIndex--; renderSlidesGrid() }
  })
  document.getElementById('class-slide-viewer-next').addEventListener('click', () => {
    if (_prepSlideIndex < _slides.length - 1) { _prepSlideIndex++; renderSlidesGrid() }
  })
  document.getElementById('class-slide-viewer-remove').addEventListener('click', () => {
    URL.revokeObjectURL(_slides[_prepSlideIndex].previewUrl)
    _slides.splice(_prepSlideIndex, 1)
    _prepSlideIndex = Math.max(0, _prepSlideIndex - 1)
    renderSlidesGrid()
    resetUI()
  })

  // Teclado: flechas para navegar slides en prep y en active view
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
    const inPrep   = !document.getElementById('class-view-prep')?.classList.contains('hidden')
    const inActive = !document.getElementById('class-view-active')?.classList.contains('hidden')
    if (inPrep) {
      if (e.key === 'ArrowLeft'  && _prepSlideIndex > 0)               { _prepSlideIndex--; renderSlidesGrid() }
      if (e.key === 'ArrowRight' && _prepSlideIndex < _slides.length - 1) { _prepSlideIndex++; renderSlidesGrid() }
    }
    if (inActive) {
      if (e.key === 'ArrowLeft')  prevSlide()
      if (e.key === 'ArrowRight') nextSlide()
    }
  })

  // Active view controls
  document.getElementById('class-slide-prev').addEventListener('click', () => prevSlide())
  document.getElementById('class-slide-next').addEventListener('click', () => nextSlide())
  document.getElementById('class-btn-end-presentation').addEventListener('click', endPresentation)

  // Q&A send
  document.getElementById('class-qa-send').addEventListener('click', sendQAResponse)
  document.getElementById('class-qa-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendQAResponse() }
  })

}

// ── Prep — file upload ────────────────────────────────────────────────────────

function resizeImage(dataUrl, maxW = 1920, maxH = 1080) {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width, maxH / img.height)
      const canvas = document.createElement('canvas')
      canvas.width  = Math.round(img.width  * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => resolve(dataUrl)  // fallback: usar original si falla el resize
    img.src = dataUrl
  })
}

function onFileChange(e) {
  const files = Array.from(e.target.files)
  if (!files.length) return
  const remaining = 3 - _slides.length
  const toProcess = files.slice(0, remaining)

  // Array indexado: garantiza que los resultados se insertan en el orden de selección,
  // sin importar cuál resizeImage termina primero
  const results = new Array(toProcess.length).fill(null)
  let done = 0

  const finish = () => {
    done++
    if (done < toProcess.length) return
    results.forEach(r => { if (r) _slides.push(r) })
    _prepSlideIndex = _slides.length - 1
    renderSlidesGrid()
    resetUI()
  }

  toProcess.forEach((file, idx) => {
    const previewUrl = URL.createObjectURL(file)
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const resized = await resizeImage(ev.target.result)
      results[idx] = { imageData: resized.split(',')[1], mimeType: 'image/jpeg', previewUrl }
      finish()
    }
    reader.onerror = () => finish()
    reader.readAsDataURL(file)
  })
  e.target.value = ''
}

function renderSlidesGrid() {
  const placeholder = document.getElementById('class-slides-placeholder')
  const viewer      = document.getElementById('class-slide-viewer')
  const dropzone    = document.getElementById('class-slides-dropzone')
  const hasSlides   = _slides.length > 0

  if (placeholder) placeholder.style.display = hasSlides ? 'none' : ''
  if (viewer)      viewer.style.display       = hasSlides ? ''     : 'none'
  if (dropzone)    dropzone.classList.toggle('has-slides', hasSlides)

  if (hasSlides) {
    _prepSlideIndex = Math.min(_prepSlideIndex, _slides.length - 1)
    const slide  = _slides[_prepSlideIndex]
    const labels = ['Intro', 'Desarrollo', 'Conclusión']
    document.getElementById('class-slide-viewer-img').src         = slide.previewUrl
    document.getElementById('class-slide-viewer-label').textContent     = labels[_prepSlideIndex] || `Slide ${_prepSlideIndex + 1}`
    document.getElementById('class-slide-viewer-indicator').textContent = `${_prepSlideIndex + 1} / ${_slides.length}`
    document.getElementById('class-slide-viewer-prev').disabled   = _prepSlideIndex === 0
    document.getElementById('class-slide-viewer-next').disabled   = _prepSlideIndex === _slides.length - 1
  }

  const count = document.getElementById('class-slides-count')
  if (count) count.textContent = _slides.length > 0 ? `${_slides.length}/3` : ''
  const canAdd = _slides.length < 3
  const addBtn     = document.getElementById('class-btn-add-slide')
  const addBtnMore = document.getElementById('class-btn-add-slide-more')
  const addOverlay = document.getElementById('class-btn-add-slide-overlay')
  if (addBtn)     addBtn.style.display     = canAdd ? '' : 'none'
  if (addBtnMore) addBtnMore.style.display = (canAdd && hasSlides) ? '' : 'none'
  if (addOverlay) addOverlay.style.display = (canAdd && hasSlides) ? '' : 'none'
}

function resetUI() {
  document.getElementById('class-btn-start').disabled = _slides.length === 0
}

// ── Start flow ────────────────────────────────────────────────────────────────

async function startClass() {
  if (_slides.length === 0) return
  showView('loading')
  setLoading('Subiendo diapositivas…', '')
  try {
    const { sessionId } = await window.api.classUploadSlides({
      paperId: _paper.id,
      duration: _selectedDuration,
      slides: _slides.map(s => ({ imageData: s.imageData, mimeType: s.mimeType }))
    })
    _sessionId = sessionId

    setLoading('Interpretando diapositivas con IA…', 'Los agentes estudiantes verán tus slides')
    await window.api.classInterpretSlides({ sessionId })

    setLoading('¡Todo listo! Iniciando clase…', '')
    const { slides } = await window.api.classStartSession({ sessionId })

    _classLanguage        = document.getElementById('class-lang-select')?.value ?? 'es'
    _transcriptionBackend = document.getElementById('class-transcription-backend-select')?.value || 'groq'
    _classModel           = _transcriptionBackend === 'groq'
      ? (document.getElementById('class-groq-model-select')?.value || 'whisper-large-v3-turbo')
      : (document.getElementById('class-model-select')?.value || 'gpt-4o-mini-transcribe')
    _localModel           = document.getElementById('class-local-model-select')?.value || 'small'
    _prepLlmProvider      = document.getElementById('class-prep-llm-provider')?.value || 'deepseek'
    _prepLlmModel         = document.getElementById('class-prep-llm-model')?.value || 'deepseek-v4-flash'
    await setupActiveView(slides)
    showView('active')
  } catch (err) {
    toast('Error al iniciar la clase: ' + err.message, 'error')
    showView('prep')
  }
}

function setLoading(msg, sub) {
  document.getElementById('class-loading-msg').textContent = msg
  document.getElementById('class-loading-sub').textContent = sub || ''
}

// ── Active view ───────────────────────────────────────────────────────────────

async function setupActiveView(slides) {
  _dbSlides = slides || []
  _currentSlideIndex = 0
  _transcript = ''
  _professorBubble = null

  renderCurrentSlide()

  // Timer
  const timerEl = document.getElementById('class-timer-display')
  _timer = new ClassTimer(_selectedDuration, (remaining) => {
    timerEl.textContent = formatTime(remaining)
    timerEl.className = 'class-timer-display' +
      (remaining <= 30 ? ' timer-urgent' : remaining <= 60 ? ' timer-warning' : '')
  }, () => {
    endPresentation()
  })
  _timer.start()

  // Webcam → persistent sidebar tile
  try {
    _webcamStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
    document.getElementById('class-webcam').srcObject = _webcamStream
  } catch {
    // Cámara no disponible: mostrar avatar placeholder en vez de ocultar el tile
    const tile = document.getElementById('class-tile-self')
    if (tile) {
      const vid = tile.querySelector('video')
      if (vid) vid.style.display = 'none'
      tile.querySelectorAll('.class-tile-avatar').forEach(el => el.remove())
      const avatar = document.createElement('div')
      avatar.className = 'class-tile-avatar'
      avatar.textContent = 'YO'
      avatar.style.background = '#64748b'
      tile.insertBefore(avatar, tile.firstChild)
    }
  }

  startSpeechRecognition()
}

function renderCurrentSlide() {
  const display = document.getElementById('class-slide-display')
  const indicator = document.getElementById('class-slide-indicator')

  if (!_dbSlides.length) {
    display.innerHTML = '<p class="class-no-slides">Sin slides</p>'
    indicator.textContent = '—'
    return
  }

  const slide = _dbSlides[_currentSlideIndex]
  display.innerHTML = ''
  const img = document.createElement('img')
  img.src = `data:${slide.mime_type};base64,${slide.image_data}`
  img.className = 'class-slide-img-full'
  display.appendChild(img)

  indicator.textContent = `${_currentSlideIndex + 1} / ${_dbSlides.length}`

  document.getElementById('class-slide-prev').disabled = _currentSlideIndex === 0
  document.getElementById('class-slide-next').disabled = _currentSlideIndex === _dbSlides.length - 1
}

function prevSlide() {
  if (_currentSlideIndex > 0) { _currentSlideIndex--; renderCurrentSlide() }
}

function nextSlide() {
  if (_currentSlideIndex < _dbSlides.length - 1) { _currentSlideIndex++; renderCurrentSlide() }
}

function stopWebcam() {
  if (_webcamStream) {
    _webcamStream.getTracks().forEach(t => t.stop())
    _webcamStream = null
    const vid = document.getElementById('class-webcam')
    if (vid) vid.srcObject = null
  }
}

async function endPresentation() {
  _timer?.stop()
  // Capture batch data before stopSpeechRecognition resets _pendingBatchAudio via rec.stop()
  const batchAudio = _pendingBatchAudio
  stopSpeechRecognition()

  if (_sessionId && _transcript) {
    await window.api.classSaveTranscript({ sessionId: _sessionId, transcript: _transcript }).catch(() => {})
  }

  // Reset Q&A state for this class
  _qaStudentIndex = 0
  _qaHistory = []
  _qaLog = []
  _qaExchangeCount = 0
  _qaActive = false
  _hintLevel = 0
  _pendingMissing = null
  _cachedHintResult = null
  document.getElementById('class-hint-bell-overlay')?.remove()
  document.getElementById('class-hint-assistant-overlay')?.remove()
  document.getElementById('class-qa-assistant-panel').classList.add('hidden')
  document.getElementById('class-qa-assistant-messages').innerHTML = ''
  _assistantHistory = []
  _assistantExcerpts = []
  _assistantMissing = null
  _assistantCanReveal = false
  document.getElementById('class-qa-messages').innerHTML = ''

  // Reset PDF toggle state
  const pdfView = document.getElementById('class-qa-pdf-view')
  pdfView.classList.add('hidden')
  pdfView.removeAttribute('data-loaded')
  document.getElementById('class-qa-pdf-hints').classList.add('hidden')
  document.getElementById('class-qa-pdf-hints-pages').innerHTML = ''
  document.getElementById('class-qa-spotlight').classList.remove('hidden')
  document.getElementById('class-btn-toggle-notes').classList.remove('active')
  _pdfHintsDoc = null
  _pdfHintsExcerpts = []
  _pdfHintsScale = 1.2

  showView('qa')
  startQA()

  // Batch transcription: transcribe after Q&A view is visible so bubbles appear in the right chat
  if (batchAudio) {
    window.api.logToMain?.(`[batch] esperando recorder... chunks=${batchAudio.chunks.length} done=${batchAudio._recorderDone}`)
    // Wait for MediaRecorder.onstop to fire (fires after last ondataavailable)
    await new Promise(resolve => {
      if (batchAudio._recorderDone) { resolve(); return }
      const check = setInterval(() => { if (batchAudio._recorderDone) { clearInterval(check); resolve() } }, 50)
      setTimeout(() => { clearInterval(check); resolve() }, 3000)
    })
    const { chunks, mimeType: batchMime } = batchAudio
    window.api.logToMain?.(`[batch] chunks=${chunks.length} backend=${_transcriptionBackend}`)
    if (chunks.length === 0) { addChatBubble('system', null, '⚠ No se grabó audio'); return }
    const loadingBubble = addChatBubble('system', null, '⏳ Transcribiendo tu presentación…')
    try {
      const blob = new Blob(chunks, { type: batchMime })
      window.api.logToMain?.(`[batch] enviando ${(blob.size / 1024).toFixed(0)} KB backend=${_transcriptionBackend} model=${_classModel}`)
      const arrayBuffer = await blob.arrayBuffer()
      const audio = Array.from(new Uint8Array(arrayBuffer))
      const isGroq = _transcriptionBackend === 'groq'
      const result = await window.api.classTranscribeAudio({
        audio,
        mimeType: batchMime,
        language: _classLanguage || undefined,
        model:    _classModel || (isGroq ? 'whisper-large-v3-turbo' : undefined),
        provider: isGroq ? 'groq' : 'openai',
      })
      loadingBubble?.remove()
      window.api.logToMain?.(`[batch] resultado: text="${(result?.text||'').slice(0,80)}" error="${result?.error||''}"`)
      if (result?.text?.trim()) {
        _transcript = result.text
        addChatBubble('professor', 'Tu presentación', result.text)
        await window.api.classSaveTranscript({ sessionId: _sessionId, transcript: _transcript }).catch(() => {})
      } else if (result?.error) {
        addChatBubble('system', null, `⚠ Error transcribiendo: ${result.error}`)
      } else {
        addChatBubble('system', null, '⚠ Transcripción vacía — habla más cerca del micrófono')
      }
    } catch (err) {
      window.api.logToMain?.(`[batch] error: ${err?.message || err}`)
      loadingBubble?.remove()
    }
  }
}

// ── ClassTimer ────────────────────────────────────────────────────────────────

class ClassTimer {
  constructor(durationSeconds, onTick, onEnd) {
    this.remaining = durationSeconds
    this.onTick = onTick
    this.onEnd = onEnd
    this._handle = null
  }
  start() {
    this.onTick(this.remaining)
    this._handle = setInterval(() => {
      this.remaining = Math.max(0, this.remaining - 1)
      this.onTick(this.remaining)
      if (this.remaining === 0) { this.stop(); this.onEnd() }
    }, 1000)
  }
  stop() {
    if (this._handle) { clearInterval(this._handle); this._handle = null }
  }
}

function formatTime(s) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// ── Q&A helpers ───────────────────────────────────────────────────────────────

function addChatBubble(type, sender, text) {
  const msgs = document.getElementById('class-qa-messages')
  const wrap = document.createElement('div')
  wrap.className = `class-qa-group class-qa-group--${type}`

  if (sender && type !== 'system') {
    const senderEl = document.createElement('div')
    senderEl.className = 'class-qa-bubble-sender'
    senderEl.textContent = sender
    wrap.appendChild(senderEl)
  }

  const bubble = document.createElement('div')
  bubble.className = `class-qa-bubble ${type}`
  bubble.textContent = text
  wrap.appendChild(bubble)

  msgs.appendChild(wrap)
  msgs.scrollTop = msgs.scrollHeight
  return bubble
}

function addTypingIndicator() {
  const msgs = document.getElementById('class-qa-messages')
  const wrap = document.createElement('div')
  wrap.id = 'class-typing-wrap'
  wrap.className = 'class-qa-group class-qa-group--student'
  const bubble = document.createElement('div')
  bubble.className = 'class-qa-bubble student class-typing-indicator'
  bubble.innerHTML = '<span></span><span></span><span></span>'
  wrap.appendChild(bubble)
  msgs.appendChild(wrap)
  msgs.scrollTop = msgs.scrollHeight
}

function removeTypingIndicator() {
  document.getElementById('class-typing-wrap')?.remove()
}

function setSpotlight(student) {
  const avatarEl = document.getElementById('class-spotlight-avatar')
  if (student) {
    avatarEl.textContent = student.initials
    avatarEl.style.background = student.color
  } else {
    avatarEl.textContent = '…'
    avatarEl.style.background = 'var(--surface-3)'
  }
  document.getElementById('class-spotlight-name').textContent = student ? student.name : 'Procesando…'
}

function highlightParticipant(studentId, active) {
  document.querySelectorAll('[data-student]').forEach(tile => {
    const match = parseInt(tile.dataset.student) === studentId
    tile.classList.toggle('speaking', match && active)
  })
}

function enableChatInput(enabled) {
  const input = document.getElementById('class-qa-input')
  const send  = document.getElementById('class-qa-send')
  const voice = document.getElementById('class-qa-voice')
  const pill  = document.getElementById('qa-pill')
  if (input) { input.disabled = !enabled; if (enabled) { input.value = ''; input.focus() } }
  if (send)  send.disabled  = !enabled
  if (voice) voice.disabled = !enabled
  if (pill)  pill.style.opacity = enabled ? '' : '.5'
}

// ── Progressive hints ─────────────────────────────────────────────────────────

const BELL_SVG = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"/>
</svg>`

const ASSISTANT_SVG = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3z"/>
</svg>`

function simpleMarkdown(text) {
  // Escape HTML entities first
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // Bold (**text** or __text__)
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>')
  // Italic (*text* or _text_)
  html = html.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>')
  html = html.replace(/_([^_\n]+?)_/g, '<em>$1</em>')

  // Convert line by line for lists and headers
  const lines = html.split('\n')
  const out = []
  let inList = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (/^#{1,3} /.test(trimmed)) {
      if (inList) { out.push('</ul>'); inList = false }
      out.push(`<strong>${trimmed.replace(/^#{1,3} /, '')}</strong>`)
    } else if (/^[-•] /.test(trimmed) || /^\d+[.)]\s/.test(trimmed)) {
      if (!inList) { out.push('<ul>'); inList = true }
      out.push(`<li>${trimmed.replace(/^[-•] /, '').replace(/^\d+[.)]\s/, '')}</li>`)
    } else {
      if (inList) { out.push('</ul>'); inList = false }
      out.push(trimmed === '' ? '<br>' : trimmed)
    }
  }
  if (inList) out.push('</ul>')

  // Join and wrap non-list, non-br consecutive text in paragraphs
  return out.join('\n')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/^/, '<p>')
    .replace(/$/, '</p>')
    .replace(/<p><br><\/p>/g, '<br>')
    .replace(/<p><\/p>/g, '')
    .replace(/<p>(<ul>)/g, '$1')
    .replace(/<\/ul><\/p>/g, '</ul>')
    .replace(/<p>(<strong>[^<]+<\/strong>)<\/p>/g, '<p>$1</p>')
}

function openAssistantPanel() {
  document.getElementById('class-qa-assistant-panel').classList.remove('hidden')
  document.getElementById('class-hint-assistant-overlay')?.classList.add('active')
}

function closeAssistantPanel() {
  document.getElementById('class-qa-assistant-panel').classList.add('hidden')
  document.getElementById('class-hint-assistant-overlay')?.classList.remove('active')
}

function addAssistantTyping() {
  const msgs = document.getElementById('class-qa-assistant-messages')
  if (!msgs || document.getElementById('class-assistant-typing')) return
  const div = document.createElement('div')
  div.id = 'class-assistant-typing'
  div.className = 'class-assistant-msg assistant class-assistant-typing-indicator'
  div.innerHTML = '<span></span><span></span><span></span>'
  msgs.appendChild(div)
  msgs.scrollTop = msgs.scrollHeight
}

function removeAssistantTyping() {
  document.getElementById('class-assistant-typing')?.remove()
}

function addAssistantMessage(text, role, isAnswer = false) {
  const msgs = document.getElementById('class-qa-assistant-messages')
  if (!msgs) return
  const div = document.createElement('div')
  div.className = `class-assistant-msg ${role}${isAnswer ? ' answer-msg' : ''}`
  if (role === 'assistant') {
    div.innerHTML = simpleMarkdown(text)
  } else {
    div.textContent = text
  }
  msgs.appendChild(div)
  msgs.scrollTop = msgs.scrollHeight
  if (role === 'assistant') {
    _assistantHistory.push({ role: 'assistant', content: text })
  }
}

function showAssistantButton() {
  if (document.getElementById('class-hint-assistant-overlay')) return
  const spotlight = document.getElementById('class-qa-spotlight')
  if (!spotlight) return
  const btn = document.createElement('button')
  btn.className = 'class-hint-assistant-overlay'
  btn.id = 'class-hint-assistant-overlay'
  btn.title = 'Abrir asistente'
  btn.innerHTML = ASSISTANT_SVG
  spotlight.appendChild(btn)
  btn.addEventListener('click', () => {
    const panel = document.getElementById('class-qa-assistant-panel')
    if (panel.classList.contains('hidden')) openAssistantPanel()
    else closeAssistantPanel()
  })
}

async function sendAssistantMessage() {
  const input = document.getElementById('class-qa-assistant-input')
  const text = input?.value?.trim()
  if (!text) return

  input.value = ''
  addAssistantMessage(text, 'user')
  _assistantHistory.push({ role: 'user', content: text })

  const sendBtn = document.getElementById('class-qa-assistant-send')
  if (sendBtn) sendBtn.disabled = true
  addAssistantTyping()

  try {
    const question = _qaHistory?.[0]?.question || ''
    const { reply } = await window.api.classAssistantMessage({
      paperId: _paper.id,
      message: text,
      question,
      missing: _assistantMissing,
      excerpts: _assistantExcerpts,
      history: _assistantHistory,
      canRevealAnswer: _assistantCanReveal,
      llmProvider: _prepLlmProvider, llmModel: _prepLlmModel
    })
    removeAssistantTyping()
    if (reply) addAssistantMessage(reply, 'assistant')
  } catch { removeAssistantTyping() } finally {
    if (sendBtn) sendBtn.disabled = false
  }
}

function showBellHint(missing) {
  if (_hintLevel < 1) _hintLevel = 1  // don't downgrade if already at level 2 or 3
  _pendingMissing = missing

  // Remove any existing bell first
  document.getElementById('class-hint-bell-overlay')?.remove()

  const spotlight = document.getElementById('class-qa-spotlight')
  if (!spotlight) return

  const btn = document.createElement('button')
  btn.className = 'class-hint-bell-overlay'
  btn.id = 'class-hint-bell-overlay'
  btn.title = '¿Necesitas ayuda? Ver fragmentos del paper'

  const icon = document.createElement('span')
  icon.className = 'class-hint-bell-icon'
  icon.innerHTML = BELL_SVG

  btn.appendChild(icon)
  spotlight.appendChild(btn)

  btn.addEventListener('click', () => {
    btn.disabled = true
    fetchAndShowExcerpts(_pendingMissing)
    // Do NOT remove — restored when PDF hints are closed
  }, { once: true })
}

function showSpotlightLoading(text = 'Buscando fragmentos…') {
  const spotlight = document.getElementById('class-qa-spotlight')
  if (!spotlight || document.getElementById('class-spotlight-loading')) return
  const el = document.createElement('div')
  el.id = 'class-spotlight-loading'
  el.className = 'class-spotlight-loading'
  el.innerHTML = `<span class="class-spotlight-loading-spinner"></span><span>${text}</span>`
  spotlight.appendChild(el)
}

function hideSpotlightLoading() {
  document.getElementById('class-spotlight-loading')?.remove()
}

async function fetchAndShowExcerpts(missing) {
  _hintLevel = 1
  const student = STUDENTS[_qaStudentIndex]

  try {
    // Call LLM only once per student turn — reuse cached result on re-open
    if (!_cachedHintResult) {
      showSpotlightLoading()
      _cachedHintResult = await window.api.classGetHint({
        studentId: student.id,
        paperId: _paper.id,
        history: _qaHistory,
        exchangeCount: 1,
        missing,
        llmProvider: _prepLlmProvider, llmModel: _prepLlmModel
      })
      hideSpotlightLoading()
    }
    await openPdfWithHighlights(_cachedHintResult?.excerpts || [])
  } catch { hideSpotlightLoading() }
}

async function renderPdfHintsPages() {
  if (!_pdfHintsDoc) return
  const pagesEl = document.getElementById('class-qa-pdf-hints-pages')

  // Preserve proportional scroll position across re-renders
  const prevScrollRatio = pagesEl.scrollHeight > 0
    ? pagesEl.scrollTop / pagesEl.scrollHeight : 0

  pagesEl.innerHTML = ''
  let refsReached = false

  for (let i = 1; i <= _pdfHintsDoc.numPages; i++) {
    const page     = await _pdfHintsDoc.getPage(i)
    const viewport = page.getViewport({ scale: _pdfHintsScale })

    const pageDiv = document.createElement('div')
    pageDiv.className = 'pdf-page'
    pageDiv.style.width    = viewport.width  + 'px'
    pageDiv.style.height   = viewport.height + 'px'
    pageDiv.style.position = 'relative'

    const canvas  = document.createElement('canvas')
    canvas.width  = viewport.width
    canvas.height = viewport.height
    pageDiv.appendChild(canvas)

    const textDiv = document.createElement('div')
    textDiv.className = 'textLayer'
    pageDiv.appendChild(textDiv)

    pagesEl.appendChild(pageDiv)

    const textContent = await page.getTextContent()
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
    const renderTask = pdfjsLib.renderTextLayer({
      textContentSource: textContent, container: textDiv, viewport, textDivs: []
    })
    await renderTask.promise

    const pageText = textContent.items.map(item => item.str).join(' ')
    if (!refsReached && isReferencesSection(pageText)) refsReached = true
    if (!refsReached) highlightExcerptsOnPage(textDiv, _pdfHintsExcerpts)
  }

  // Update zoom label
  const zoomEl = document.getElementById('class-pdf-zoom-level')
  if (zoomEl) zoomEl.textContent = Math.round(_pdfHintsScale * 100) + '%'

  // Restore scroll position
  pagesEl.scrollTop = prevScrollRatio * pagesEl.scrollHeight
}

async function openPdfWithHighlights(excerpts) {
  const url = await window.api.getPdfUrl(_paper?.id)
  if (!url) return

  _pdfHintsExcerpts = excerpts

  // Hide spotlight and native PDF, show PDF.js hints view
  document.getElementById('class-qa-spotlight').classList.add('hidden')
  document.getElementById('class-qa-pdf-view').classList.add('hidden')

  const hintsView = document.getElementById('class-qa-pdf-hints')
  const pagesEl   = document.getElementById('class-qa-pdf-hints-pages')
  hintsView.classList.remove('hidden')
  pagesEl.innerHTML = '<div class="class-hint-loading">Cargando PDF…</div>'

  try {
    _pdfHintsDoc = await pdfjsLib.getDocument(url).promise
    await renderPdfHintsPages()

    const firstHit = pagesEl.querySelector('.hint-highlight')
    if (firstHit) firstHit.scrollIntoView({ behavior: 'smooth', block: 'center' })
  } catch {
    pagesEl.innerHTML = '<div class="class-hint-loading">No se pudo cargar el PDF.</div>'
  }
}

function isReferencesSection(pageText) {
  // Matches "References", "Bibliography", "Referencias", "Bibliografía" as a standalone heading
  // at the very start of the page text or as an isolated line
  return /^\s*(references|bibliography|referencias|bibliograf[íi]a|works cited)\s*$/im.test(
    pageText.slice(0, 300)
  )
}

function highlightExcerptsOnPage(textLayerDiv, excerpts) {
  const spans = Array.from(textLayerDiv.querySelectorAll('span'))
  if (!spans.length) return

  // Build character-position index across spans (with single space separator)
  let pos = 0
  const parts = spans.map(span => {
    const text  = span.textContent
    const entry = { span, start: pos, end: pos + text.length }
    pos += text.length + 1
    return entry
  })
  const fullText = spans.map(s => s.textContent).join(' ').toLowerCase()

  for (const excerpt of excerpts) {
    const norm  = excerpt.toLowerCase().replace(/\s+/g, ' ').trim()
    if (norm.length < 15) continue

    const words = norm.split(' ')
    // Minimum window: 5 consecutive words (never single words)
    const minWindow = Math.min(5, Math.ceil(words.length / 2))
    let matched = false

    // Try the longest window first and shrink until minWindow
    outer: for (let wSize = words.length; wSize >= minWindow; wSize--) {
      for (let i = 0; i <= words.length - wSize; i++) {
        const phrase = words.slice(i, i + wSize).join(' ')
        const idx = fullText.indexOf(phrase)
        if (idx === -1) continue

        for (const { span, start, end } of parts) {
          if (end > idx && start < idx + phrase.length) {
            span.classList.add('hint-highlight')
          }
        }
        matched = true
        break outer  // Only highlight the first (longest) match per excerpt
      }
    }

    // No window of minWindow+ words found on this page — skip this excerpt
    void matched
  }
}

function closePdfHints() {
  document.getElementById('class-qa-pdf-hints').classList.add('hidden')
  document.getElementById('class-qa-spotlight').classList.remove('hidden')

  // Restore the bell at any hint level — it's always available once shown
  if (_hintLevel >= 1 && _pendingMissing !== null) {
    showBellHint(_pendingMissing)
  }
}

async function fetchAndShowGuidance(missing) {
  _hintLevel = 2
  _assistantMissing = missing
  showAssistantButton()
  openAssistantPanel()
  addAssistantTyping()
  const student = STUDENTS[_qaStudentIndex]
  try {
    const result = await window.api.classGetHint({
      studentId: student.id,
      paperId: _paper.id,
      history: _qaHistory,
      exchangeCount: 2,
      missing,
      llmProvider: _prepLlmProvider, llmModel: _prepLlmModel
    })
    removeAssistantTyping()
    if (result?.excerpts?.length) _assistantExcerpts = result.excerpts
    if (result?.guidance) addAssistantMessage(result.guidance, 'assistant')
  } catch { removeAssistantTyping() }
}

async function fetchAndShowAnswer(missing) {
  _hintLevel = 3
  _assistantCanReveal = true
  _assistantMissing = missing
  showAssistantButton()
  openAssistantPanel()
  addAssistantTyping()
  const student = STUDENTS[_qaStudentIndex]
  try {
    const result = await window.api.classGetHint({
      studentId: student.id,
      paperId: _paper.id,
      history: _qaHistory,
      exchangeCount: 3,
      missing,
      llmProvider: _prepLlmProvider, llmModel: _prepLlmModel
    })
    removeAssistantTyping()
    if (result?.excerpts?.length) _assistantExcerpts = result.excerpts
    if (result?.answer) addAssistantMessage(result.answer, 'assistant', true)
  } catch { removeAssistantTyping() }
}

// ── Q&A orchestration ─────────────────────────────────────────────────────────

async function startQA() {
  _qaActive = true
  addChatBubble('system', null, 'La presentación ha terminado. Los estudiantes tienen preguntas.')
  await processStudent(0)
}

async function processStudent(index) {
  if (index >= STUDENTS.length) {
    await finishQA()
    return
  }

  const student = STUDENTS[index]
  _qaStudentIndex = index
  _qaHistory = []
  _qaExchangeCount = 0
  _hintLevel = 0
  _pendingMissing = null
  _cachedHintResult = null
  document.getElementById('class-hint-bell-overlay')?.remove()
  document.getElementById('class-hint-assistant-overlay')?.remove()
  document.getElementById('class-qa-assistant-panel').classList.add('hidden')
  document.getElementById('class-qa-assistant-messages').innerHTML = ''
  _assistantHistory = []
  _assistantExcerpts = []
  _assistantMissing = null
  _assistantCanReveal = false
  document.getElementById('class-qa-pdf-hints').classList.add('hidden')
  document.getElementById('class-qa-pdf-hints-pages').innerHTML = ''
  document.getElementById('class-qa-spotlight').classList.remove('hidden')
  _pdfHintsDoc = null
  _pdfHintsExcerpts = []
  _pdfHintsScale = 1.2

  setSpotlight(student)
  highlightParticipant(student.id, true)
  document.getElementById('class-qa-progress').textContent = `Estudiante ${index + 1} / ${STUDENTS.length}`

  addTypingIndicator()
  try {
    const { question } = await window.api.classStudentQuestion({
      studentId: student.id,
      paperId: _paper.id,
      sessionId: _sessionId,
      history: [],
      previousQA: _qaLog.map(q => ({ studentName: q.studentName, question: q.question })),
      llmProvider: _prepLlmProvider, llmModel: _prepLlmModel
    })
    removeTypingIndicator()
    if (!question) throw new Error('empty question')
    addChatBubble('student', student.name, question)
    _qaHistory.push({ question, answer: null })
    enableChatInput(true)
  } catch {
    removeTypingIndicator()
    addChatBubble('system', null, `No se pudo obtener pregunta de ${student.name}. Continuando…`)
    _qaLog.push({ studentId: student.id, studentName: student.name, question: '', professorAnswer: '', hintLevel: 0 })
    highlightParticipant(student.id, false)
    setTimeout(() => processStudent(index + 1), 1000)
  }
}

async function sendQAResponse() {
  const input = document.getElementById('class-qa-input')
  const text  = input?.value?.trim()
  if (!text || !_qaActive) return

  enableChatInput(false)

  const student = STUDENTS[_qaStudentIndex]
  addChatBubble('professor', 'Tú', text)

  if (_qaHistory.length > 0) _qaHistory[_qaHistory.length - 1].answer = text
  _qaExchangeCount++

  addTypingIndicator()
  try {
    const result = await window.api.classStudentEvaluate({
      studentId: student.id,
      paperId: _paper.id,
      sessionId: _sessionId,
      professorAnswer: text,
      history: _qaHistory,
      exchangeCount: _qaExchangeCount,
      llmProvider: _prepLlmProvider, llmModel: _prepLlmModel
    })
    removeTypingIndicator()

    const satisfiedOrMaxed = result.satisfied || _qaExchangeCount >= 4

    // Always activate the hint for this round before deciding whether to continue
    if (_qaExchangeCount === 1 && _hintLevel === 0 && !result.satisfied) {
      showBellHint(result.missing)
    } else if (_qaExchangeCount === 2 && _hintLevel <= 1 && !result.satisfied) {
      await fetchAndShowGuidance(result.missing)
    } else if (_qaExchangeCount === 3 && _hintLevel <= 2 && !result.satisfied) {
      await fetchAndShowAnswer(result.missing)
    }

    if (satisfiedOrMaxed) {
      addChatBubble('student', student.name, result.reaction)
      _qaLog.push({
        studentId: student.id,
        studentName: student.name,
        question: _qaHistory[0]?.question || '',
        professorAnswer: text,
        hintLevel: _hintLevel
      })
      highlightParticipant(student.id, false)
      setTimeout(() => processStudent(_qaStudentIndex + 1), 1400)
    } else {

      addTypingIndicator()
      try {
        const { question } = await window.api.classStudentQuestion({
          studentId: student.id,
          paperId: _paper.id,
          sessionId: _sessionId,
          history: _qaHistory,
          previousQA: _qaLog.map(q => ({ studentName: q.studentName, question: q.question })),
          reaction: result.reaction,
          llmProvider: _prepLlmProvider, llmModel: _prepLlmModel
        })
        removeTypingIndicator()
        if (!question) throw new Error('empty question')
        addChatBubble('student', student.name, question)
        _qaHistory.push({ question, answer: null })
        enableChatInput(true)
      } catch {
        removeTypingIndicator()
        _qaLog.push({ studentId: student.id, studentName: student.name, question: _qaHistory[0]?.question || '', professorAnswer: text, hintLevel: _hintLevel })
        highlightParticipant(student.id, false)
        setTimeout(() => processStudent(_qaStudentIndex + 1), 800)
      }
    }
  } catch {
    removeTypingIndicator()
    addChatBubble('system', null, 'Error al evaluar respuesta. Puedes continuar.')
    enableChatInput(true)
  }
}

async function finishQA() {
  _qaActive = false
  highlightParticipant(-1, false)
  setSpotlight(null)
  document.getElementById('class-qa-progress').textContent = 'Calculando resultados…'
  enableChatInput(false)

  let endResult = { presentationScore: 70, qaScore: 70, presentationFeedback: null, perStudent: _qaLog }

  try {
    endResult = await window.api.classEndSession({
      sessionId: _sessionId,
      transcript: _transcript,
      qaLog: _qaLog,
      llmProvider: _prepLlmProvider, llmModel: _prepLlmModel
    })
  } catch {}

  renderResults(endResult)
  showView('results')
}

const HINT_LABELS = ['Sin ayuda', 'Campanilla', 'Asistente', 'Respuesta revelada']
const HINT_COLORS = ['var(--green)', 'var(--yellow)', 'var(--orange)', 'var(--red)']
const HINT_SCORES = [100, 70, 40, 0]

function renderResults({ presentationScore, qaScore, presentationFeedback, perStudent }) {
  // Scores
  const finalScore = (presentationScore != null && qaScore != null)
    ? Math.round((presentationScore + qaScore) / 2) : '—'
  document.getElementById('class-score-final-num').textContent = finalScore
  document.getElementById('class-score-pres-num').textContent  = presentationScore ?? '—'
  document.getElementById('class-score-qa-num').textContent    = qaScore ?? '—'

  // Presentation feedback
  const pf = presentationFeedback || {}
  document.getElementById('class-pres-feedback').textContent    = pf.feedback    || ''
  document.getElementById('class-pres-strengths').textContent   = pf.strengths   || ''
  document.getElementById('class-pres-improvements').textContent = pf.improvements || ''

  // Q&A table
  const table = document.getElementById('class-qa-table-body')
  table.innerHTML = ''
  const students = perStudent || _qaLog
  students.forEach(qa => {
    const level = qa.hintLevel ?? 0
    const pts   = HINT_SCORES[level] ?? 100
    const row = document.createElement('tr')
    row.innerHTML = `
      <td class="qat-student">${qa.studentName || '—'}</td>
      <td class="qat-question">${qa.question || '—'}</td>
      <td class="qat-hint">
        <span class="hint-badge" style="background:${HINT_COLORS[level]}22;color:${HINT_COLORS[level]};border-color:${HINT_COLORS[level]}44">
          ${HINT_LABELS[level] || '—'}
        </span>
      </td>
      <td class="qat-score" style="color:${HINT_COLORS[level]}">${pts}</td>`
    table.appendChild(row)
  })
}

// ── Recording indicator ───────────────────────────────────────────────────────

function setRecordingIndicator(active, label = 'Escuchando…') {
  const el  = document.getElementById('class-rec-indicator')
  const lbl = document.getElementById('class-rec-label')
  if (!el) return
  el.classList.toggle('hidden', !active)
  if (lbl) lbl.textContent = label
}

// ── Transcripción: Web Speech API (default, rápida) + Whisper (fallback) ─────


// Frases que Whisper alucina cuando hay silencio o ruido de fondo
const WHISPER_HALLUCINATIONS = [
  // Silencio / ruido de fondo (whisper alucina estas con micro abierto sin voz)
  '♪', '...', 'música', 'aplausos', 'risas', 'silencio',
  'music', 'applause', 'laughter', 'noise', 'inaudible',
  // Saludos de YouTube que whisper "imagina" (silencio detectado como intro de video)
  '¡hola!', '¡hola, ', '¡halo!', 'halo,', 'abuenas', 'a buenas',
  'en clips', 'en clipsión', 'clipsión',
  // YouTube / streaming (español)
  'gracias por ver el vídeo', 'gracias por ver el video', 'gracias por ver',
  'suscríbete', 'suscribete', 'like y suscríbete', 'dale like',
  'nos vemos en el próximo', 'nos vemos en el siguiente', 'hasta el próximo',
  'y eso es todo', 'eso es todo amigos', 'y nos vemos',
  'hasta la próxima', 'hasta pronto amigos', 'chao amigos', 'chau amigos',
  'subtítulos realizados', 'amara.org',
  // YouTube / streaming (inglés)
  'thanks for watching', 'thank you for watching',
  'please subscribe', 'don\'t forget to subscribe', 'hit the like button',
  'see you in the next', 'see you next time', 'that\'s all for today',
  'subtitles by', 'captions by',
  // Artefactos genéricos
  'se viva', 'alimmenta', 'amara.org', 'comunidad de amara', 'subtítulos realizados', 'norte de brasil',
  'marquías, humanos', 'oficina de marquías',
  'www.', '.com', '.org', '.net',   // URLs siempre son alucinación
  // Prompt-completion hallucinations (whisper repite el prompt cuando no entiende)
  'el profesor explica', 'universidad autónoma de méxico',
  'por qué están nos llorando',
]

// Detecta artefactos de ruido: palabra única repetida 4+ veces (ej. "no, no, no, no")
const REPEATED_WORD_RE = /\b(\w{1,6})[,.]?\s+(?:\1[,.]?\s+){3,}\1\b/i

function isHallucination(text) {
  const t = text.toLowerCase().trim()
  if (WHISPER_HALLUCINATIONS.some(p => t.includes(p))) return true
  if (REPEATED_WORD_RE.test(t)) return true
  return false
}

async function startSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
  console.log('[speech] backend:', _transcriptionBackend, '| SpeechRecognition available:', !!SpeechRecognition)
  if (_transcriptionBackend === 'webspeech' && SpeechRecognition) {
    startWebSpeechRecognition(SpeechRecognition)
  } else if (_transcriptionBackend === 'whisper-local') {
    await startWhisperLocalStream()
  } else {
    await startWhisperRecognition()
  }
}

// Errores que indican que Web Speech API no funciona en este entorno → fallback a Whisper
const FATAL_SPEECH_ERRORS = new Set(['network', 'service-not-allowed', 'not-allowed', 'audio-capture'])

function startWebSpeechRecognition(SpeechRecognition) {
  const liveEl = document.getElementById('class-transcript-live')
  const recognition = new SpeechRecognition()
  recognition.continuous = true
  recognition.interimResults = true

  recognition.onstart = () => {
    console.log('[speech] Web Speech API started')
    if (liveEl) liveEl.textContent = '🎙 Escuchando…'
    setRecordingIndicator(true, 'Escuchando (Web Speech)…')
  }

  recognition.onresult = (event) => {
    let interim = ''
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const t = event.results[i][0].transcript
      if (event.results[i].isFinal) {
        appendTranscript(t)
      } else {
        interim += t
      }
    }
    if (liveEl && interim) liveEl.textContent = '🎙 ' + interim
  }

  recognition.onerror = (event) => {
    console.warn('[speech] Web Speech error:', event.error)
    if (event.error === 'no-speech') return

    if (FATAL_SPEECH_ERRORS.has(event.error)) {
      console.warn('[speech] Fatal error — falling back to Whisper')
      _recognitionActive = false
      _speechRecognition = null
      if (liveEl) liveEl.textContent = '🎙 Cambiando a Whisper…'
      startWhisperRecognition()
      return
    }

    if (liveEl) liveEl.textContent = `⚠ ${event.error}`
  }

  recognition.onend = () => {
    console.log('[speech] Web Speech ended — active:', _recognitionActive)
    if (_recognitionActive) recognition.start()
  }

  _recognitionActive = true
  _speechRecognition = recognition
  recognition.start()
}

async function startWhisperLocalStream() {
  const liveEl = document.getElementById('class-transcript-live')
  if (liveEl) liveEl.textContent = '🎙 Iniciando whisper local…'

  const result = await window.api.classStartStream({ language: _classLanguage || 'es', localModel: _localModel || 'small' })
  if (result?.error) {
    if (liveEl) liveEl.textContent = `⚠ ${result.error}`
    return
  }

  _usingWhisperLocal = true
  window.api.onStreamText((text) => {
    console.log('[stream-text]', text)
    if (!isHallucination(text)) appendTranscript(text)
    else console.warn('[hallucination filtered]', text)
  })
  window.api.onStreamDebug?.((msg) => {
    console.log('[whisper-debug]', msg)
    if (liveEl) liveEl.textContent = msg.slice(0, 120)
  })
  if (liveEl) liveEl.textContent = '🎙 Iniciando modelo…'
  setRecordingIndicator(true, 'Transcribiendo con whisper.cpp…')
}

async function startWhisperRecognition() {
  const liveEl = document.getElementById('class-transcript-live')
  if (liveEl) liveEl.textContent = '🔴 Grabando…'

  let stream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
  } catch {
    if (liveEl) liveEl.textContent = '⚠ Sin acceso al micrófono'
    return
  }

  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm'

  // Batch mode: record raw stream, amplify PCM post-capture before sending to Whisper
  const audioChunks = []
  _mediaRecorder = new MediaRecorder(stream, { mimeType })
  _mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data) }
  _mediaRecorder.start(5000)  // collect in 5s pieces (keeps memory bounded)

  setRecordingIndicator(true, 'Grabando…')

  _audioCtx = { close: () => stream.getTracks().forEach(t => t.stop()) }
  _pendingBatchAudio = { chunks: audioChunks, mimeType }
}

// ── Voice input buttons (push-to-talk for Q&A and assistant chat) ─────────────

function attachVoiceButton({ micBtnId, sendBtnId, cancelBtnId, confirmBtnId, textareaId, waveformId, sendFn }) {
  const micBtn     = document.getElementById(micBtnId)
  const sendBtn    = document.getElementById(sendBtnId)
  const cancelBtn  = document.getElementById(cancelBtnId)
  const confirmBtn = document.getElementById(confirmBtnId)
  const waveformEl = document.getElementById(waveformId)
  if (!micBtn) return

  let _voiceRecorder  = null
  let _voiceStream    = null
  let _voiceChunks    = []
  let _cancelled      = false
  let _animFrame      = null
  let _analyser       = null
  let _vadCtx         = null

  const bars = waveformEl ? Array.from(waveformEl.querySelectorAll('.waveform-bar')) : []

  function showRecordingUI(show) {
    const textarea = document.getElementById(textareaId)
    if (textarea)     textarea.classList.toggle('hidden', show)
    if (waveformEl)   waveformEl.classList.toggle('hidden', !show)
    if (cancelBtn)    cancelBtn.classList.toggle('hidden', !show)
    if (confirmBtn)   confirmBtn.classList.toggle('hidden', !show)
    if (micBtn)       micBtn.classList.toggle('hidden', show)
    if (sendBtn)      sendBtn.classList.toggle('hidden', show)
  }

  function startWaveform(stream) {
    _vadCtx  = new AudioContext()
    _analyser = _vadCtx.createAnalyser()
    _analyser.fftSize = 64
    _vadCtx.createMediaStreamSource(stream).connect(_analyser)
    const data = new Uint8Array(_analyser.frequencyBinCount)
    function draw() {
      _analyser.getByteFrequencyData(data)
      bars.forEach((bar, i) => {
        const val = data[Math.floor(i * data.length / bars.length)] || 0
        const h = Math.max(3, (val / 255) * 26)
        bar.style.height = h + 'px'
      })
      _animFrame = requestAnimationFrame(draw)
    }
    draw()
  }

  function stopWaveform() {
    cancelAnimationFrame(_animFrame)
    _animFrame = null
    bars.forEach(b => { b.style.height = '4px' })
    _analyser = null
    _vadCtx?.close()
    _vadCtx = null
  }

  function resetUI() {
    showRecordingUI(false)
    micBtn.classList.remove('recording')
    stopWaveform()
  }

  async function startRecording() {
    try {
      _voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    } catch (err) {
      toast('Sin acceso al micrófono: ' + (err.message || err), 'error')
      return
    }
    _cancelled   = false
    _voiceChunks = []
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus' : 'audio/webm'

    _voiceRecorder = new MediaRecorder(_voiceStream, { mimeType })
    _voiceRecorder.ondataavailable = e => { if (e.data.size > 0) _voiceChunks.push(e.data) }
    _voiceRecorder.onstop = async () => {
      _voiceStream?.getTracks().forEach(t => t.stop())
      _voiceStream = null
      stopWaveform()
      showRecordingUI(false)
      micBtn.classList.remove('recording')

      if (_cancelled) return

      const blob = new Blob(_voiceChunks, { type: mimeType })
      if (blob.size < 100) { toast('No se detectó audio', 'error'); return }

      micBtn.style.opacity = '.4'
      try {
        const arrayBuffer = await blob.arrayBuffer()
        const audio = Array.from(new Uint8Array(arrayBuffer))
        const result = await window.api.classTranscribeAudio({
          audio, mimeType,
          language: _classLanguage || undefined,
          model: _classModel || undefined
        })
        if (result?.error) { toast('Error: ' + result.error, 'error'); return }
        const text = result?.text?.trim()
        if (!text || isHallucination(text)) { toast('No se detectó voz en el audio', 'error'); return }
        const textarea = document.getElementById(textareaId)
        if (textarea) { textarea.value = text; textarea.dispatchEvent(new Event('input')) }
        sendFn()
      } catch (err) {
        toast('Error al transcribir: ' + (err.message || 'intenta de nuevo'), 'error')
      } finally {
        micBtn.style.opacity = ''
      }
    }

    _voiceRecorder.start(500)
    micBtn.classList.add('recording')
    showRecordingUI(true)
    startWaveform(_voiceStream)
  }

  function confirmRecording() {
    _cancelled = false
    if (_voiceRecorder?.state === 'recording') _voiceRecorder.stop()
  }

  micBtn.addEventListener('click', startRecording)

  cancelBtn?.addEventListener('click', () => {
    _cancelled = true
    if (_voiceRecorder?.state === 'recording') _voiceRecorder.stop()
    else resetUI()
  })

  confirmBtn?.addEventListener('click', confirmRecording)

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && _voiceRecorder?.state === 'recording') {
      e.preventDefault()
      confirmRecording()
    }
  })
}

function stopSpeechRecognition() {
  // Web Speech API
  _recognitionActive = false
  if (_speechRecognition) {
    _speechRecognition.stop()
    _speechRecognition = null
  }
  // Whisper local subprocess
  if (_usingWhisperLocal) {
    window.api.classStopStream?.()
    window.api.removeAllListeners?.('class-stream-text')
    _usingWhisperLocal = false
  }
  // Whisper cloud batch mode — stop recorder and collect all chunks
  clearInterval(_transcribeInterval)
  _transcribeInterval = null
  clearInterval(_vadPoll)
  _vadPoll = null
  if (_mediaRecorder && _pendingBatchAudio) {
    const rec = _mediaRecorder
    _mediaRecorder = null
    rec.ondataavailable = (e) => { if (e.data.size > 0) _pendingBatchAudio.chunks.push(e.data) }
    rec.onstop = () => { _pendingBatchAudio._recorderDone = true }
    try { rec.stop() } catch {}
    // AudioContext and stream tracks stopped via _audioCtx.close() below
  } else if (_mediaRecorder) {
    const rec = _mediaRecorder
    _mediaRecorder = null
    try { rec.stop() } catch {}
    try { rec.stream.getTracks().forEach(t => t.stop()) } catch {}
  }
  if (_audioCtx) { _audioCtx.close(); _audioCtx = null }
  setRecordingIndicator(false)
}

// ── Transcript ────────────────────────────────────────────────────────────────

export function appendTranscript(text) {
  if (!text) return
  _transcript += ' ' + text

  // Crear burbuja del profesor la primera vez; después solo actualizar su texto
  if (!_professorBubble) {
    _professorBubble = addChatBubble('professor', 'Profesor', text.trim())
  } else {
    _professorBubble.textContent = _transcript.trim()
  }

  // Scroll al último mensaje
  const msgs = document.getElementById('class-qa-messages')
  if (msgs) msgs.scrollTop = msgs.scrollHeight

  // La barra live solo muestra estado
  const liveEl = document.getElementById('class-transcript-live')
  if (liveEl) liveEl.textContent = '🎙 Escuchando…'
}

// Export state for later phases
export function getSessionState() {
  return { paper: _paper, sessionId: _sessionId, dbSlides: _dbSlides, duration: _selectedDuration, transcript: _transcript }
}
