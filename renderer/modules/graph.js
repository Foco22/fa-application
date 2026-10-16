// Mapa de papers en 3D: cada referencia y cada paper semanal es un nodo; las
// aristas unen los abstracts más cercanos (cálculo en main: get-graph). Aquí sólo
// se dibuja (canvas 2D con proyección en perspectiva), se navega (arrastrar =
// rotar, rueda = zoom) y se muestra el panel de calidad.
import { t } from './language.js'
import { layoutGraph, nodeRadius, communityColor, rotatePoint, projectPoint } from './graph-layout.js'
import { qualityChecks } from './graph-quality.js'

const LAYOUT_RADIUS = 250
const CAMERA_DISTANCE = 900
const DRAG_THRESHOLD = 4        // px; menos que esto es un click, no un arrastre

let openPaperFn = null
let data = null            // respuesta de get-graph
let pos = []               // posición 3D por nodo (centrada en el origen)
let proj = []              // proyección a pantalla del frame actual
let degree = []
let cam = { yaw: 0.6, pitch: -0.35, zoom: 1, fitZoom: 1 }
let autoRotate = true
let hover = -1
let focusCommunity = null  // id de la comunidad resaltada desde la leyenda (null = ninguna)
let drag = null           // { idx, lastX, lastY, startX, startY, moved }
let loadToken = 0
let resizeObserver = null
let rafId = null

const $ = (id) => document.getElementById(id)

/* ── Apertura / cierre ──────────────────────────────────────────────────── */

export function isGraphOpen() {
  return !$('graph-panel').classList.contains('hidden')
}

export async function openGraphView() {
  $('content-panel').classList.add('hidden')
  $('chat-panel').classList.add('hidden')
  // Los paneles de la barra son excluyentes.
  for (const [panel, btn] of [['learning-panel', 'act-learning'], ['costs-panel', 'act-costs']]) {
    $(panel).classList.add('hidden')
    $(btn).classList.remove('active')
  }
  $('graph-panel').classList.remove('hidden')
  $('act-graph').classList.add('active')
  observeResize()
  startLoop()
  await load()
}

export function closeGraphView() {
  $('graph-panel').classList.add('hidden')
  $('content-panel').classList.remove('hidden')
  $('chat-panel').classList.remove('hidden')
  $('act-graph').classList.remove('active')
  resizeObserver?.disconnect()
  resizeObserver = null
  stopLoop()
}

/* ── Carga ──────────────────────────────────────────────────────────────── */

function showEmpty(text) {
  $('graph-empty-text').textContent = text
  $('graph-empty').classList.remove('hidden')
  $('graph-canvas').classList.add('hidden')
}

async function load() {
  const token = ++loadToken
  showEmpty(t('grafo-cargando'))
  $('graph-quality').innerHTML = ''
  $('graph-notes').textContent = ''

  const res = await window.api.getGraph({
    k: Number($('graph-k').value),
    center: $('graph-center').checked,
  })
  if (token !== loadToken) return   // llegó una respuesta más nueva

  if (res?.error === 'no-embeddings') { data = null; return showEmpty(t('grafo-sin-embeddings')) }
  if (!res?.nodes?.length)            { data = null; return showEmpty(t('grafo-vacio')) }

  data = res
  degree = new Array(data.nodes.length).fill(0)
  for (const e of data.edges) { degree[e.source]++; degree[e.target]++ }
  pos = layoutGraph(data.nodes, data.edges, { radius: LAYOUT_RADIUS })

  $('graph-empty').classList.add('hidden')
  $('graph-canvas').classList.remove('hidden')
  hover = -1
  focusCommunity = null
  resizeCanvas()
  fitView()
  renderSide()
  draw()
}

/* ── Aristas visibles (filtro de "conexiones débiles") ──────────────────── */

// El slider oculta el p% de aristas más débiles; es relativo a la distribución
// porque el rango de similitudes cambia según el modelo y el centrado.
function visibleEdges() {
  if (!data) return []
  const p = Number($('graph-min').value)
  if (p === 0 || data.edges.length === 0) return data.edges
  const sorted = data.edges.map(e => e.weight).sort((a, b) => a - b)
  const cut = sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
  return data.edges.filter(e => e.weight >= cut)
}

/* ── Cámara ─────────────────────────────────────────────────────────────── */

function canvasSize() {
  const canvas = $('graph-canvas')
  const dpr = window.devicePixelRatio || 1
  return { w: canvas.width / dpr, h: canvas.height / dpr, dpr }
}

function resizeCanvas() {
  const canvas = $('graph-canvas')
  const dpr = window.devicePixelRatio || 1
  const { width, height } = canvas.parentElement.getBoundingClientRect()
  canvas.width  = Math.max(1, Math.floor(width * dpr))
  canvas.height = Math.max(1, Math.floor(height * dpr))
}

function observeResize() {
  if (resizeObserver) return
  resizeObserver = new ResizeObserver(() => { if (data) { resizeCanvas(); draw() } })
  resizeObserver.observe($('graph-canvas').parentElement)
}

// Encuadra la esfera del layout en el canvas y vuelve a la vista inicial.
function fitView() {
  const { w, h } = canvasSize()
  cam.fitZoom = (Math.min(w, h) * 0.42) / LAYOUT_RADIUS
  cam.zoom = cam.fitZoom
  cam.yaw = 0.6
  cam.pitch = -0.35
  autoRotate = true
}

function projectAll() {
  const { w, h } = canvasSize()
  const camera = { distance: CAMERA_DISTANCE, zoom: cam.zoom, cx: w / 2, cy: h / 2 }
  proj = pos.map(p => projectPoint(rotatePoint(p, cam.yaw, cam.pitch), camera))
}

/* ── Dibujo ─────────────────────────────────────────────────────────────────  */

function cssVar(name, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

function neighborsOf(idx, edges) {
  const set = new Set([idx])
  for (const e of edges) {
    if (e.source === idx) set.add(e.target)
    else if (e.target === idx) set.add(e.source)
  }
  return set
}

function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s }
const clamp01 = (x) => Math.min(1, Math.max(0, x))

// Lo lejano se ve más tenue y pequeño: es la pista de profundidad principal.
const FACTOR_MIN = CAMERA_DISTANCE / (CAMERA_DISTANCE + LAYOUT_RADIUS)
const FACTOR_MAX = CAMERA_DISTANCE / (CAMERA_DISTANCE - LAYOUT_RADIUS)
const depthT = (factor) => clamp01((factor - FACTOR_MIN) / (FACTOR_MAX - FACTOR_MIN))

function pixelRadius(i) {
  return nodeRadius(degree[i]) * proj[i].factor * Math.sqrt(cam.zoom / cam.fitZoom)
}

function draw() {
  if (!data) return
  const canvas = $('graph-canvas')
  const ctx = canvas.getContext('2d')
  const { dpr } = canvasSize()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr)
  projectAll()

  const edges = visibleEdges()
  // Foco: el nodo bajo el cursor y sus vecinos, o —si no hay hover— la comunidad elegida en la leyenda.
  const communityFocus = focusCommunity == null ? null
    : new Set(data.nodes.map((n, i) => (n.community === focusCommunity ? i : -1)).filter(i => i >= 0))
  const focus = hover >= 0 ? neighborsOf(hover, edges) : communityFocus
  const weights = edges.map(e => e.weight)
  const lo = Math.min(...weights), hi = Math.max(...weights)
  const norm = (w) => (hi > lo ? (w - lo) / (hi - lo) : 1)
  const textColor = cssVar('--text', '#f5f5f7')
  const bg = cssVar('--surface-1', '#111')

  // Aristas más lejanas primero; más gruesas y opacas cuanto más parecidos son los abstracts.
  const sortedEdges = [...edges].sort((a, b) =>
    (proj[a.source].z + proj[a.target].z) - (proj[b.source].z + proj[b.target].z))
  for (const e of sortedEdges) {
    const a = proj[e.source], b = proj[e.target]
    const touches = focus && (hover >= 0 ? (e.source === hover || e.target === hover) : (focus.has(e.source) && focus.has(e.target)))
    const fog = 0.35 + 0.65 * depthT((a.factor + b.factor) / 2)
    const alpha = focus ? (touches ? 0.9 : 0.04) : (0.12 + 0.5 * norm(e.weight)) * fog
    ctx.beginPath()
    ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy)
    ctx.strokeStyle = `rgba(160,175,200,${alpha})`
    ctx.lineWidth = (0.5 + 2.4 * norm(e.weight)) * ((a.factor + b.factor) / 2)
    ctx.setLineDash(e.mutual ? [] : [4, 3])
    ctx.stroke()
  }
  ctx.setLineDash([])

  // Nodos de atrás hacia adelante (algoritmo del pintor).
  const order = data.nodes.map((_, i) => i).sort((a, b) => proj[a].z - proj[b].z)
  for (const i of order) {
    const node = data.nodes[i]
    const { sx, sy, factor } = proj[i]
    const r = pixelRadius(i)
    const color = communityColor(node.community)
    const fog = 0.45 + 0.55 * depthT(factor)
    ctx.globalAlpha = focus && !focus.has(i) ? 0.15 : fog

    if (node.kind === 'reference') {            // referencia: anillo
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2)
      ctx.fillStyle = bg; ctx.fill()
      ctx.lineWidth = Math.max(1.5, 2.5 * factor); ctx.strokeStyle = color; ctx.stroke()
    } else {                                    // paper semanal: esfera sombreada
      const g = ctx.createRadialGradient(sx - r * 0.35, sy - r * 0.35, r * 0.1, sx, sy, r)
      g.addColorStop(0, '#ffffffcc'); g.addColorStop(0.25, color); g.addColorStop(1, color)
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2)
      ctx.fillStyle = g; ctx.fill()
    }
    if (i === hover) {
      ctx.globalAlpha = 1
      ctx.beginPath(); ctx.arc(sx, sy, r + 2, 0, Math.PI * 2)
      ctx.lineWidth = 2; ctx.strokeStyle = textColor; ctx.stroke()
    }
    ctx.globalAlpha = 1
  }

  // Etiquetas: el nodo señalado y sus vecinos; al acercar el zoom, también los del frente.
  const zoomedIn = cam.zoom / cam.fitZoom > 1.6
  ctx.font = '12px Inter, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = textColor
  for (const i of order) {
    const show = focus ? focus.has(i) : zoomedIn && depthT(proj[i].factor) > 0.5
    if (!show) continue
    ctx.fillText(truncate(data.nodes[i].title, 32), proj[i].sx, proj[i].sy - pixelRadius(i) - 6)
  }
}

/* ── Animación (giro lento hasta que el usuario toma el control) ────────── */

function startLoop() {
  if (rafId != null) return
  const tick = () => {
    rafId = requestAnimationFrame(tick)
    if (!data || !autoRotate || drag || hover >= 0) return
    cam.yaw += 0.004
    draw()
  }
  rafId = requestAnimationFrame(tick)
}

function stopLoop() {
  if (rafId != null) cancelAnimationFrame(rafId)
  rafId = null
}

/* ── Interacción ────────────────────────────────────────────────────────── */

function localPoint(clientX, clientY) {
  const rect = $('graph-canvas').getBoundingClientRect()
  return { px: clientX - rect.left, py: clientY - rect.top }
}

// El nodo bajo el cursor; si se superponen varios gana el más cercano a la cámara.
function hitTest(clientX, clientY) {
  const { px, py } = localPoint(clientX, clientY)
  let best = -1, bestZ = -Infinity
  proj.forEach((p, i) => {
    if (Math.hypot(p.sx - px, p.sy - py) <= pixelRadius(i) + 3 && p.z > bestZ) { best = i; bestZ = p.z }
  })
  return best
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function showTooltip(idx, px, py) {
  const tip = $('graph-tooltip')
  if (idx < 0) { tip.classList.add('hidden'); return }
  const node = data.nodes[idx]
  const links = visibleEdges().filter(e => e.source === idx || e.target === idx)
    .sort((a, b) => b.weight - a.weight).slice(0, 3)
    .map(e => {
      const other = data.nodes[e.source === idx ? e.target : e.source]
      return `<div>${t('grafo-similitud')} ${(e.cosine ?? e.weight).toFixed(2)} · ${escapeHtml(truncate(other.title, 44))}</div>`
    }).join('')
  const hint = node.kind === 'reference' ? t('grafo-abrir-ref') : t('grafo-abrir-paper')
  const community = (data.communities || []).find(c => c.id === node.community)
  const tag = community ? `<div class="graph-tip-tag" data-color="${communityColor(community.id)}">● ${escapeHtml(communityName(community))}</div>` : ''
  tip.innerHTML = `<strong>${escapeHtml(node.title)}</strong>${tag}${escapeHtml(truncate(node.abstract || '', 220))}${links ? `<div class="graph-tip-links">${links}</div>` : ''}<div class="graph-tip-hint">${hint}</div>`
  tip.querySelectorAll('[data-color]').forEach(el => { el.style.color = el.dataset.color })   // CSP: sin style inline
  tip.classList.remove('hidden')
  const stage = $('graph-canvas').parentElement.getBoundingClientRect()
  tip.style.left = Math.max(8, Math.min(px + 14, stage.width - tip.offsetWidth - 8)) + 'px'
  tip.style.top  = Math.max(8, Math.min(py + 14, stage.height - tip.offsetHeight - 8)) + 'px'
}

function wireCanvas() {
  const canvas = $('graph-canvas')

  canvas.addEventListener('mousedown', (e) => {
    if (!data) return
    drag = { idx: hitTest(e.clientX, e.clientY), lastX: e.clientX, lastY: e.clientY, startX: e.clientX, startY: e.clientY, moved: false }
    canvas.classList.add('dragging')
  })

  window.addEventListener('mousemove', (e) => {
    if (!data || !isGraphOpen()) return
    if (drag) {
      if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_THRESHOLD) return
      drag.moved = true
      autoRotate = false
      showTooltip(-1)
      // Arrastrar gira la escena (yaw con el eje horizontal, pitch con el vertical).
      cam.yaw   += (e.clientX - drag.lastX) * 0.008
      cam.pitch  = Math.max(-1.45, Math.min(1.45, cam.pitch + (e.clientY - drag.lastY) * 0.008))
      drag.lastX = e.clientX; drag.lastY = e.clientY
      draw()
      return
    }
    const rect = canvas.getBoundingClientRect()
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return
    const idx = hitTest(e.clientX, e.clientY)
    if (idx !== hover) { hover = idx; canvas.classList.toggle('over-node', idx >= 0); draw() }
    showTooltip(idx, e.clientX - rect.left, e.clientY - rect.top)
  })

  window.addEventListener('mouseup', () => {
    if (!drag) return
    const { idx, moved } = drag
    drag = null
    canvas.classList.remove('dragging')
    // Click sin arrastre sobre un paper semanal → abrirlo.
    if (!moved && idx >= 0 && data.nodes[idx].kind === 'paper') {
      closeGraphView()
      openPaperFn?.(data.nodes[idx].id)
    }
  })

  canvas.addEventListener('dblclick', (e) => {
    if (!data) return
    const idx = hitTest(e.clientX, e.clientY)
    if (idx >= 0 && data.nodes[idx].kind === 'reference') window.api.openFile(data.nodes[idx].id.slice(4))
  })

  canvas.addEventListener('mouseleave', () => {
    if (drag) return
    hover = -1; showTooltip(-1); draw()
  })

  canvas.addEventListener('wheel', (e) => {
    if (!data) return
    e.preventDefault()
    cam.zoom = Math.min(cam.fitZoom * 5, Math.max(cam.fitZoom * 0.3, cam.zoom * Math.exp(-e.deltaY * 0.0015)))
    draw()
  }, { passive: false })
}

/* ── Panel lateral ──────────────────────────────────────────────────────── */

const MARKS = { ok: '✓', warn: '⚠', info: 'ℹ' }

function formatCheck(c) {
  if (c.id === 'too-few') return ''
  if (c.id === 'hubs') return `${c.value.toFixed(1)}×`
  if (c.id === 'isolated') return String(c.value)
  if (c.id === 'precision' || c.id === 'stability') return `${Math.round(c.value * 100)}%`
  return c.value.toFixed(2)
}

// Leyenda: el color de cada comunidad con el nombre que sale de sus abstracts.
// Click = resaltar esa comunidad en el grafo; otro click la suelta.
function communityName(c) {
  return c.label || t('grafo-grupo').replace('{n}', c.id + 1)
}

// Todas las comunidades que existen en el grafo, con o sin nombre calculado: si por
// cualquier razón falta alguna en `data.communities`, se arma desde los nodos.
function allCommunities() {
  const named = new Map((data.communities || []).map(c => [c.id, c]))
  const sizes = new Map()
  for (const n of data.nodes) sizes.set(n.community, (sizes.get(n.community) || 0) + 1)
  return [...sizes.entries()]
    .map(([id, size]) => named.get(id) || { id, size, label: '', terms: [] })
    .sort((a, b) => b.size - a.size || a.id - b.id)
}

// OJO: la CSP de la app (style-src 'self') bloquea los atributos style="…" inline,
// incluso los escritos vía innerHTML. Los colores se asignan por CSSOM (el.style.x),
// que sí está permitido.
function renderCommunities() {
  const list = $('graph-communities')
  list.innerHTML = ''
  for (const c of allCommunities()) {
    const li = document.createElement('li')
    li.classList.toggle('active', c.id === focusCommunity)

    const dot = document.createElement('i')
    dot.className = 'gc-dot'
    dot.style.background = communityColor(c.id)
    const label = document.createElement('span')
    label.className = 'gc-label'
    label.textContent = communityName(c)
    const count = document.createElement('span')
    count.className = 'gc-count'
    count.textContent = c.size
    li.append(dot, label, count)

    li.addEventListener('click', () => {
      focusCommunity = focusCommunity === c.id ? null : c.id
      renderCommunities()
      draw()
    })
    list.appendChild(li)
  }
}

function renderSide() {
  $('graph-summary').textContent = t('grafo-resumen')
    .replace('{nodes}', data.nodes.length).replace('{edges}', visibleEdges().length)

  const list = $('graph-quality')
  list.innerHTML = ''
  for (const c of qualityChecks(data.metrics)) {
    const li = document.createElement('li')
    li.className = `gq-${c.status}`
    const label = c.id === 'too-few' ? t('gq-too-few').replace('{n}', c.value) : t(`gq-${c.id}`)
    li.innerHTML = `<span class="gq-mark">${MARKS[c.status]}</span><span>${escapeHtml(label)}</span><span class="gq-value">${formatCheck(c)}</span>`
    list.appendChild(li)
  }

  renderCommunities()

  const notes = []
  if (data.stale?.length)  notes.push(t('grafo-stale').replace('{n}', data.stale.length))
  if (data.missing?.length) notes.push(t('grafo-faltan').replace('{n}', data.missing.length))
  $('graph-notes').textContent = notes.join(' ')
}

/* ── Init ───────────────────────────────────────────────────────────────── */

export function initGraph({ openPaper }) {
  openPaperFn = openPaper
  wireCanvas()

  $('btn-close-graph').addEventListener('click', closeGraphView)
  $('graph-fit').addEventListener('click', () => { fitView(); draw() })

  const kInput = $('graph-k')
  kInput.addEventListener('input', () => { $('graph-k-val').textContent = kInput.value })
  kInput.addEventListener('change', load)           // cambia la estructura → recalcular
  $('graph-center').addEventListener('change', load)

  const minInput = $('graph-min')
  minInput.addEventListener('input', () => {
    $('graph-min-val').textContent = `${minInput.value}%`
    if (data) { renderSide(); draw() }              // sólo filtra: el layout no se mueve
  })
}
