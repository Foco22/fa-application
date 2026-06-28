import { state } from './state.js'
import { toast } from './toast.js'
import { escAttr } from './utils.js'

let _openPaper      = () => {}
let _showContextMenu = () => {}

export function initVault({ openPaper, showContextMenu }) {
  _openPaper       = openPaper
  _showContextMenu = showContextMenu
}

function isoWeek(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
  const week1 = new Date(d.getFullYear(), 0, 4)
  return 1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7)
}

function paperSlot(p) {
  const d = new Date(p.published_date || p.created_at || Date.now())
  const week = isoWeek(d)
  return { year: String(d.getFullYear()), weekKey: `week-${String(week).padStart(2, '0')}` }
}

function groupByYearWeek(list) {
  const groups = {}
  for (const p of list) {
    const { year, weekKey } = paperSlot(p)
    if (!groups[year])          groups[year] = {}
    if (!groups[year][weekKey]) groups[year][weekKey] = []
    groups[year][weekKey].push(p)
  }
  return groups
}

export function autoExpandRecent() {
  if (state.papers.length === 0) return
  const { year, weekKey } = paperSlot(state.papers[0])
  state.expandedNodes.add(`y-${year}`)
  state.expandedNodes.add(`w-${year}-${weekKey}`)
}

export function toggleNode(key) {
  if (state.expandedNodes.has(key)) state.expandedNodes.delete(key)
  else state.expandedNodes.add(key)
  renderVault()
}

export function renderVault() {
  const list  = document.getElementById('vault-list')
  const count = document.getElementById('vault-count')
  count.textContent = state.papers.filter(p => !p.id.startsWith('ref-')).length
  list.innerHTML = ''

  const mainPapers = state.papers.filter(p => !p.id.startsWith('ref-'))

  if (mainPapers.length === 0) {
    const empty = document.createElement('div')
    empty.style.cssText = 'padding:16px 12px;font-size:11px;color:var(--text-3);text-align:center;'
    empty.textContent = 'Sin papers'
    list.appendChild(empty)
  } else {
    const groups = groupByYearWeek(mainPapers)
    const years  = Object.keys(groups).sort((a, b) => b - a)

    for (const year of years) {
      const yearKey    = `y-${year}`
      const isYearOpen = state.expandedNodes.has(yearKey)

      const yearEl = document.createElement('div')
      yearEl.className = 'tree-year' + (isYearOpen ? ' open' : '')
      yearEl.innerHTML = `<span class="tree-arrow">${isYearOpen ? '▾' : '▸'}</span><span class="tree-label">${year}</span>`
      yearEl.addEventListener('click', () => toggleNode(yearKey))
      list.appendChild(yearEl)

      if (!isYearOpen) continue

      const weeks = Object.keys(groups[year]).sort().reverse()
      for (const weekKey of weeks) {
        const wKey       = `w-${year}-${weekKey}`
        const isWeekOpen = state.expandedNodes.has(wKey)
        const weekLabel  = weekKey.replace('week-', 'W')

        const weekEl = document.createElement('div')
        weekEl.className = 'tree-week' + (isWeekOpen ? ' open' : '')
        weekEl.innerHTML = `<span class="tree-arrow">${isWeekOpen ? '▾' : '▸'}</span><span class="tree-label">${weekLabel}</span>`
        weekEl.addEventListener('click', () => toggleNode(wKey))
        list.appendChild(weekEl)

        if (!isWeekOpen) continue

        for (const p of groups[year][weekKey]) {
          const isActive    = state.activePaper?.id === p.id
          const isPaperOpen = isActive

          const paperEl = document.createElement('div')
          paperEl.className = 'tree-paper' + (isActive ? ' active' : '')
          paperEl.dataset.id = p.id
          paperEl.innerHTML = `
            <span class="tree-arrow">${isPaperOpen ? '▾' : '▸'}</span>
            <span class="tree-label" title="${escAttr(p.title || p.id)}">${p.title || p.id}</span>
          `
          paperEl.addEventListener('click', (e) => {
            e.stopPropagation()
            _openPaper(p.id)
          })
          paperEl.addEventListener('contextmenu', (e) => {
            e.preventDefault()
            e.stopPropagation()
            _showContextMenu(e.clientX, e.clientY, p.id)
          })
          list.appendChild(paperEl)

          if (isPaperOpen) {
            const rawEl = document.createElement('div')
            rawEl.className = 'tree-sub'
            rawEl.innerHTML = `<span class="tree-sub-arrow">›</span><span class="tree-label">raw</span>`
            rawEl.addEventListener('click', (e) => { e.stopPropagation(); _openPaper(p.id, 'pdf') })
            list.appendChild(rawEl)

            const assetsEl = document.createElement('div')
            assetsEl.className = 'tree-sub'
            assetsEl.innerHTML = `<span class="tree-sub-arrow">›</span><span class="tree-label">assets</span>`
            assetsEl.addEventListener('click', (e) => { e.stopPropagation(); _openPaper(p.id, 'resumen') })
            list.appendChild(assetsEl)
          }
        }
      }
    }
  }

  // Referencias node — siempre al final del árbol
  const refNodeKey  = 'referencias'
  const isRefOpen   = state.expandedNodes.has(refNodeKey)
  const refYearEl   = document.createElement('div')
  refYearEl.className = 'tree-year' + (isRefOpen ? ' open' : '')
  refYearEl.innerHTML = `<span class="tree-arrow">${isRefOpen ? '▾' : '▸'}</span><span class="tree-label">Referencias</span>`
  refYearEl.addEventListener('click', () => { toggleNode(refNodeKey); renderVault() })

  refYearEl.addEventListener('dragover', (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    refYearEl.classList.add('drag-over')
  })
  refYearEl.addEventListener('dragleave', () => refYearEl.classList.remove('drag-over'))
  refYearEl.addEventListener('drop', async (e) => {
    e.preventDefault()
    refYearEl.classList.remove('drag-over')
    const paths = Array.from(e.dataTransfer.files)
      .filter(f => f.name.toLowerCase().endsWith('.pdf'))
      .map(f => f.path)
    if (paths.length === 0) return
    refYearEl.querySelector('.tree-label').textContent = 'Indexando…'
    const { indexed, errors } = await window.api.indexFiles(paths)
    state.papers    = await window.api.getPapers()
    state.refPapers = await window.api.getReferenceList()
    if (!state.expandedNodes.has(refNodeKey)) state.expandedNodes.add(refNodeKey)
    renderVault()
    toast(`+${indexed} referencia${indexed !== 1 ? 's' : ''} indexada${indexed !== 1 ? 's' : ''}${errors > 0 ? `, ${errors} errores` : ''}`, indexed > 0 ? 'success' : 'info')
  })

  list.appendChild(refYearEl)

  if (isRefOpen) {
    if (state.refPapers.length === 0) {
      const emptyEl = document.createElement('div')
      emptyEl.className = 'tree-week'
      emptyEl.style.cssText = 'color:var(--text-3);padding-left:28px;font-size:11px;cursor:default'
      emptyEl.textContent = 'Sin papers indexados'
      list.appendChild(emptyEl)
    } else {
      for (const ref of state.refPapers) {
        const refEl = document.createElement('div')
        refEl.className = 'tree-week ref-item'
        refEl.innerHTML = `
          <span class="tree-arrow" style="visibility:hidden">▸</span>
          <span class="ref-label" title="${escAttr(ref.path)}">${ref.name}</span>
          <div class="ref-actions">
            <button class="ref-action-btn ref-rename-btn" title="Renombrar">✎</button>
            <button class="ref-action-btn ref-delete-btn" title="Eliminar">✕</button>
          </div>`

        refEl.addEventListener('contextmenu', (e) => {
          e.preventDefault()
          e.stopPropagation()
          _showContextMenu(e.clientX, e.clientY, ref.paperId, { path: ref.path, paperId: ref.paperId })
        })

        refEl.addEventListener('click', async (e) => {
          if (e.target.closest('.ref-actions')) return
          const p = await window.api.getPaper(ref.paperId)
          if (p) {
            _openPaper(ref.paperId)
          } else {
            refEl.querySelector('.ref-label').textContent = 'Indexando…'
            await window.api.indexFiles([ref.path])
            state.papers    = await window.api.getPapers()
            state.refPapers = await window.api.getReferenceList()
            renderVault()
            _openPaper(ref.paperId)
          }
        })

        refEl.querySelector('.ref-rename-btn').addEventListener('click', (e) => {
          e.stopPropagation()
          const label = refEl.querySelector('.ref-label')
          const current = label.textContent
          const input = document.createElement('input')
          input.className = 'ref-rename-input'
          input.value = current
          label.replaceWith(input)
          input.focus(); input.select()

          const finish = async () => {
            const newTitle = input.value.trim() || current
            if (newTitle !== current) {
              await window.api.renameReference({ paperId: ref.paperId, newTitle })
              state.papers    = await window.api.getPapers()
              state.refPapers = await window.api.getReferenceList()
              renderVault()
            } else {
              const newLabel = document.createElement('span')
              newLabel.className = 'ref-label'
              newLabel.textContent = current
              input.replaceWith(newLabel)
            }
          }
          input.addEventListener('blur', finish)
          input.addEventListener('keydown', e => {
            if (e.key === 'Enter')  { e.preventDefault(); input.blur() }
            if (e.key === 'Escape') { input.value = current; input.blur() }
          })
        })

        refEl.querySelector('.ref-delete-btn').addEventListener('click', async (e) => {
          e.stopPropagation()
          await window.api.deleteReference({ filePath: ref.path, paperId: ref.paperId })
          state.papers    = await window.api.getPapers()
          state.refPapers = await window.api.getReferenceList()
          if (state.activePaper?.id === ref.paperId) state.activePaper = null
          renderVault()
        })

        list.appendChild(refEl)
      }
    }
  }
}
