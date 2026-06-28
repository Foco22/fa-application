import { state } from './modules/state.js'
import { TABS } from './modules/constants.js'
import { toast } from './modules/toast.js'
import { renderVault, autoExpandRecent, initVault } from './modules/vault.js'
import { openPaper, initPaperView } from './modules/paper-view.js'
import { showContextMenu, hideContextMenu, initContextMenu } from './modules/context-menu.js'
import { showOnboarding, initOnboarding } from './modules/onboarding.js'
import { loadPdf } from './modules/pdf.js'
import { flushNotesRender, onNotesClick, onNotesKeydown, onNotesInput, onNotesBlur } from './modules/notes.js'
import { hideAnnotationPopup, setupAnnotationPopup, toggleHighlightsPanel, rebuildNotesFromHighlights } from './modules/highlights.js'
import { startSummary } from './modules/summary.js'
import { generateQuiz } from './modules/quiz.js'
import { sendChat, clearChat } from './modules/chat.js'
import { openSettings, saveSettings } from './modules/settings.js'
import { enterClassMode, exitClassMode, initClass } from './modules/class.js'

/* ── PDF expand ─────────────────────────────────────────────────────────── */

export function setPdfExpanded(val) {
  state.pdfExpanded = val
  document.getElementById('content-panel').classList.toggle('pdf-expanded', val)
  document.getElementById('btn-pdf-expand').textContent = val ? '⤡ Reducir' : '⤢ Ampliar'
}

/* ── Tabs ───────────────────────────────────────────────────────────────── */

export function switchTab(tab) {
  if (tab === 'clase') {
    if (state.activePaper) enterClassMode(state.activePaper)
    return
  }
  if (tab !== 'pdf' && state.pdfExpanded) setPdfExpanded(false)
  if (tab !== 'pdf') hideAnnotationPopup()
  if (state.activeTab === 'notas' && tab !== 'notas') flushNotesRender()
  state.activeTab = tab
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab)
  })
  TABS.forEach(t => {
    document.getElementById(`tab-${t}`).classList.toggle('hidden', t !== tab)
  })
  const scroll = document.getElementById('content-scroll')
  if (tab === 'pdf') {
    scroll.classList.add('pdf-active')
    loadPdf()
  } else {
    scroll.classList.remove('pdf-active')
  }
  if (tab === 'notas') document.getElementById('pv-notes').focus()
}

/* ── Dependency injection ───────────────────────────────────────────────── */

initVault({ openPaper, showContextMenu })
initPaperView({ renderVault, switchTab, setPdfExpanded })
initContextMenu({ openPaper, renderVault })

/* ── Fetch ──────────────────────────────────────────────────────────────── */

async function triggerFetch() {
  const actBtn   = document.getElementById('act-fetch')
  const status   = document.getElementById('fetch-status')
  actBtn.disabled = true
  actBtn.classList.add('spinning')
  status.textContent = 'Buscando papers…'

  try {
    const result = await window.api.fetchPapers()
    if (result && result.error) {
      toast('Error: ' + result.error, 'error')
      status.textContent = '⚠ ' + result.error
    } else if (Array.isArray(result)) {
      state.papers = await window.api.getPapers()
      autoExpandRecent()
      renderVault()
      if (result.length > 0) {
        status.textContent = `${result.length} paper${result.length > 1 ? 's' : ''} importado${result.length > 1 ? 's' : ''}`
        toast(status.textContent, 'success')
        await openPaper(result[0].id)
      } else {
        status.textContent = 'Sin papers nuevos'
      }
      setTimeout(() => { status.textContent = '' }, 4000)
    }
  } catch (err) {
    toast('Error: ' + err.message, 'error')
    status.textContent = '⚠ Error'
  }
  actBtn.disabled = false
  actBtn.classList.remove('spinning')
}

/* ── Main app ───────────────────────────────────────────────────────────── */

async function showApp() {
  document.getElementById('onboarding').classList.add('hidden')
  document.getElementById('app').classList.remove('hidden')

  state.papers    = await window.api.getPapers()
  state.refPapers = await window.api.getReferenceList()
  autoExpandRecent()
  renderVault()
  if (state.papers.length > 0) await openPaper(state.papers[0].id)
  wireListeners()
  setupAnnotationPopup()
}

initOnboarding({ showApp })

/* ── Event wiring ───────────────────────────────────────────────────────── */

function wireListeners() {
  initClass()
  document.getElementById('btn-win-min').addEventListener('click', () => window.api.minimizeWindow())
  document.getElementById('btn-win-max').addEventListener('click', () => window.api.maximizeWindow())
  document.getElementById('btn-win-close').addEventListener('click', () => window.api.closeWindow())

  document.getElementById('act-fetch').addEventListener('click', triggerFetch)

  document.getElementById('act-papers').addEventListener('click', () => {
    if (!document.getElementById('class-fullscreen').classList.contains('hidden')) {
      exitClassMode()
      return
    }
    document.getElementById('vault-panel').classList.toggle('collapsed')
  })
  document.getElementById('act-settings').addEventListener('click', openSettings)

  // Zoom controls
  const ZOOM_STEP = 0.1
  const ZOOM_MIN  = 0.6
  const ZOOM_MAX  = 2.0
  const contentScroll = document.getElementById('content-scroll')
  const zoomLabel     = document.getElementById('zoom-level')

  let zoomLevel = parseFloat(localStorage.getItem('readingZoom') || '1')

  function applyZoom(z) {
    zoomLevel = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))
    contentScroll.style.zoom = zoomLevel
    zoomLabel.textContent = Math.round(zoomLevel * 100) + '%'
    localStorage.setItem('readingZoom', zoomLevel)
  }

  applyZoom(zoomLevel)

  document.getElementById('btn-zoom-in').addEventListener('click',  () => applyZoom(zoomLevel + ZOOM_STEP))
  document.getElementById('btn-zoom-out').addEventListener('click', () => applyZoom(zoomLevel - ZOOM_STEP))

  contentScroll.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return
    e.preventDefault()
    applyZoom(zoomLevel + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP))
  }, { passive: false })

  document.getElementById('btn-open-vault').addEventListener('click', () => window.api.openVaultFolder())
  document.getElementById('act-chat').addEventListener('click', () => {
    document.getElementById('chat-panel').classList.toggle('collapsed')
  })

  document.getElementById('btn-close-settings').addEventListener('click', () => {
    document.getElementById('settings-panel').classList.add('hidden')
  })
  document.getElementById('btn-save-settings').addEventListener('click', saveSettings)

  document.getElementById('btn-pick-ref-folder').addEventListener('click', async () => {
    const folder = await window.api.selectFolder()
    if (folder) document.getElementById('s-ref-folder').value = folder
  })

  document.getElementById('btn-reindex').addEventListener('click', async () => {
    const btn = document.getElementById('btn-reindex')
    btn.disabled = true; btn.textContent = 'Indexando…'
    const { indexed, errors, total } = await window.api.indexReferenceFolder()
    document.getElementById('s-ref-stats').textContent = `${total} paper${total !== 1 ? 's' : ''} indexado${total !== 1 ? 's' : ''}`
    btn.disabled = false; btn.textContent = 'Re-indexar'
    toast(`+${indexed} indexados${errors > 0 ? `, ${errors} errores` : ''}`, indexed > 0 ? 'success' : 'info')
    state.refPapers = await window.api.getReferenceList()
    renderVault()
  })

  document.getElementById('settings-panel').addEventListener('click', e => {
    if (e.target === document.getElementById('settings-panel'))
      document.getElementById('settings-panel').classList.add('hidden')
  })

  // Tab bar
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab))
  })

  document.getElementById('btn-pdf-expand').addEventListener('click', () => setPdfExpanded(!state.pdfExpanded))
  document.getElementById('btn-highlights-toggle').addEventListener('click', toggleHighlightsPanel)
  document.getElementById('btn-rebuild-notes').addEventListener('click', rebuildNotesFromHighlights)
  document.getElementById('btn-summary').addEventListener('click', startSummary)
  document.getElementById('btn-quiz').addEventListener('click', generateQuiz)
  document.getElementById('pv-notes').addEventListener('click',   onNotesClick)
  document.getElementById('pv-notes').addEventListener('keydown', onNotesKeydown)
  document.getElementById('pv-notes').addEventListener('input',   onNotesInput)
  document.getElementById('pv-notes').addEventListener('blur',    onNotesBlur)

  document.getElementById('btn-chat-send').addEventListener('click', sendChat)
  document.getElementById('chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat() }
  })
  document.getElementById('btn-clear-chat').addEventListener('click', clearChat)

  // Chat resize handle
  const chatPanel        = document.getElementById('chat-panel')
  const chatResizeHandle = document.getElementById('chat-resize-handle')
  const CHAT_MIN_W = 240
  const chatMaxW   = () => Math.floor(window.innerWidth * 0.62)

  const savedChatW = localStorage.getItem('chatPanelWidth')
  if (savedChatW) chatPanel.style.setProperty('--chat-panel-w', savedChatW + 'px')

  chatResizeHandle.addEventListener('mousedown', (e) => {
    e.preventDefault()
    chatResizeHandle.classList.add('dragging')
    chatPanel.style.transition = 'none'
    const startX = e.clientX
    const startW = chatPanel.offsetWidth

    const onMove = (ev) => {
      const newW = Math.max(CHAT_MIN_W, Math.min(chatMaxW(), startW + (startX - ev.clientX)))
      chatPanel.style.setProperty('--chat-panel-w', newW + 'px')
    }
    const onUp = () => {
      chatResizeHandle.classList.remove('dragging')
      chatPanel.style.transition = ''
      localStorage.setItem('chatPanelWidth', chatPanel.offsetWidth)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  })

  window.api.onNewPapers(async count => {
    state.papers = await window.api.getPapers()
    autoExpandRecent()
    renderVault()
    toast(`${count} paper${count > 1 ? 's' : ''} nuevo${count > 1 ? 's' : ''}`, 'success')
  })
}

/* ── Copy code blocks ───────────────────────────────────────────────────── */

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.copy-btn')
  if (!btn) return
  const code = btn.closest('.code-block')?.querySelector('code')
  if (!code) return
  navigator.clipboard.writeText(code.textContent).then(() => {
    btn.textContent = '✓ Copiado'
    btn.classList.add('copied')
    setTimeout(() => {
      btn.textContent = 'Copiar'
      btn.classList.remove('copied')
    }, 2000)
  }).catch(() => {})
})

/* ── Boot ───────────────────────────────────────────────────────────────── */

async function boot() {
  const done = await window.api.checkOnboarding()
  if (!done) showOnboarding()
  else await showApp()
}

boot()
