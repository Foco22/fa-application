import { state } from './state.js'
import { toast } from './toast.js'
import { t } from './language.js'

let _openPaper   = () => {}
let _renderVault = () => {}

export function initContextMenu({ openPaper, renderVault }) {
  _openPaper   = openPaper
  _renderVault = renderVault
}

let ctxPaperId = null
let ctxRefData  = null

const ctxMenu   = document.getElementById('ctx-menu')
const ctxRename = ctxMenu.querySelector('[data-action="rename"]')

export function showContextMenu(x, y, paperId, refData = null) {
  ctxPaperId = paperId
  ctxRefData = refData
  ctxRename.classList.toggle('ctx-hidden', !refData)
  ctxMenu.style.left = `${x}px`
  ctxMenu.style.top  = `${y}px`
  ctxMenu.classList.remove('hidden')

  const rect = ctxMenu.getBoundingClientRect()
  if (rect.right  > window.innerWidth)  ctxMenu.style.left = `${x - rect.width}px`
  if (rect.bottom > window.innerHeight) ctxMenu.style.top  = `${y - rect.height}px`
}

export function hideContextMenu() {
  ctxMenu.classList.add('hidden')
  ctxPaperId = null
  ctxRefData = null
}

ctxMenu.addEventListener('click', async (e) => {
  const action = e.target.dataset.action
  if (!action || !ctxPaperId) return
  const id  = ctxPaperId
  const ref = ctxRefData
  hideContextMenu()

  if (action === 'open') {
    _openPaper(id)
  } else if (action === 'delete') {
    if (ref) {
      await window.api.deleteReference({ filePath: ref.path, paperId: ref.paperId })
      state.papers    = await window.api.getPapers()
      state.refPapers = await window.api.getReferenceList()
    } else {
      await window.api.deletePaper(id)
      state.papers = state.papers.filter(p => p.id !== id)
    }
    if (state.activePaper?.id === id) {
      state.activePaper = null
      document.getElementById('paper-view').classList.add('hidden')
      document.getElementById('empty-state').classList.remove('hidden')
    }
    _renderVault()
    toast(t('eliminado'), 'info')
  } else if (action === 'rename' && ref) {
    const current  = state.papers.find(p => p.id === ref.paperId)?.title || ref.paperId
    const newTitle = window.prompt('Nuevo nombre:', current)
    if (newTitle && newTitle.trim() && newTitle.trim() !== current) {
      await window.api.renameReference({ paperId: ref.paperId, newTitle: newTitle.trim() })
      state.papers    = await window.api.getPapers()
      state.refPapers = await window.api.getReferenceList()
      _renderVault()
    }
  }
})

document.addEventListener('click', hideContextMenu)
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideContextMenu() })
