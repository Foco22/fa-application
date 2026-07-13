import { t, getLanguage } from './language.js'
let chart = null
let groupBy = 'week'
let range = { from: null, to: null }

// Color por proveedor: FIJO y por entidad, nunca por posición. Filtrar un rango
// que deja fuera a un proveedor no puede repintar a los que quedan.
// Paleta validada para superficie oscura (banda de luminosidad, croma, contraste
// ≥3:1 y separación para daltonismo — peor par adyacente ΔE 15.7 en tritanopía).
const PROVIDER_COLORS = {
  anthropic: '#3987e5',
  openai:    '#199e70',
  deepseek:  '#c98500',
  groq:      '#9085e9',
  local:     '#d55181',
}
const PROVIDER_ORDER = ['anthropic', 'openai', 'deepseek', 'groq', 'local']

const MICRO_PER_USD = 1_000_000

// Se divide por 1e6 SOLO al mostrar: las sumas ya vinieron hechas sobre enteros
// en micro-USD desde SQL, sin drift de punto flotante.
function usd(micro) {
  if (micro == null) return '—'
  const value = micro / MICRO_PER_USD
  if (value === 0) return '$0'
  // Un gasto de $0.0003 no puede mostrarse como "$0.00": se usan 4 decimales
  // salvo que la cifra sea lo bastante grande como para no necesitarlos.
  return value >= 1 ? `$${value.toFixed(2)}` : `$${value.toFixed(4)}`
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

// Las acciones son claves del diccionario, no texto fijo: la tabla de detalle
// también tiene que hablar el idioma de la app.
const ACTION_KEYS = {
  summary: 'accion-summary', quiz: 'accion-quiz', chat: 'accion-chat',
  embedding: 'accion-embedding', transcription: 'accion-transcription',
  vision: 'accion-vision', affiliations: 'accion-affiliations',
  metadata: 'accion-metadata', abstract_summary: 'accion-abstract-summary',
}

// Etiquetas del eje: la semana se muestra como "sem. 2 mar", no como fecha cruda.
// El locale sale del idioma activo: con la UI en inglés, el eje no puede seguir
// diciendo "sem. 15 jun".
function periodLabel(period) {
  const locale = getLanguage()
  if (groupBy === 'month') {
    const [y, m] = period.split('-')
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(locale, { month: 'short', year: '2-digit' })
  }
  const d = new Date(`${period}T00:00:00`)
  const short = d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })
  return groupBy === 'week' ? `${t('semana-abrev')} ${short}` : short
}

function renderChart(summary) {
  const labels = summary.buckets.map(b => periodLabel(b.period))

  // Solo los proveedores presentes, pero siempre en el orden fijo — así el color
  // de cada uno no depende de cuántos aparezcan.
  // Se comprueba la PRESENCIA de la clave, no que sea truthy: los proveedores
  // locales cuestan 0 y un `by_provider[p]` falsy los borraría de la leyenda,
  // que es exactamente lo que no debe pasar ("Local — $0" es una serie más).
  const providers = PROVIDER_ORDER.filter(p =>
    summary.buckets.some(b => Object.prototype.hasOwnProperty.call(b.by_provider, p))
  )

  const datasets = providers.map(p => ({
    label: p,
    data: summary.buckets.map(b => (b.by_provider[p] || 0) / MICRO_PER_USD),
    backgroundColor: PROVIDER_COLORS[p],
    // 2px del color de la superficie entre segmentos apilados: separa las capas
    // sin agregar una línea de color que compita con los datos.
    borderColor: cssVar('--surface-0'),
    borderWidth: 2,
    borderRadius: 4,
    borderSkipped: false,
  }))

  chart?.destroy()
  chart = new Chart(document.getElementById('ct-chart'), {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { labels: { color: cssVar('--text-2'), boxWidth: 10, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${usd(ctx.parsed.y * MICRO_PER_USD)}`,
            footer: (items) => {
              const total = items.reduce((s, i) => s + i.parsed.y, 0)
              return `Total: ${usd(total * MICRO_PER_USD)}`
            },
          },
        },
      },
      scales: {
        x: { stacked: true, ticks: { color: cssVar('--text-3'), font: { size: 10 } }, grid: { display: false } },
        y: {
          stacked: true, beginAtZero: true,
          ticks: {
            color: cssVar('--text-3'), font: { size: 10 },
            // Los decimales del eje se eligen según la magnitud del período: con
            // gastos de dólares, "$0.9000" es ruido; con gastos de centésimas,
            // "$0.00" borraría el dato.
            callback: (v) => (v === 0 ? '$0' : v >= 0.1 ? `$${v.toFixed(2)}` : `$${v.toFixed(4)}`),
          },
          grid: { display: false },
        },
      },
    },
  })
}

function renderActionTable(summary) {
  const tbody = document.getElementById('ct-action-table')
  tbody.innerHTML = ''

  for (const row of summary.by_action) {
    const tr = document.createElement('tr')
    const cells = [
      ACTION_KEYS[row.action_type] ? t(ACTION_KEYS[row.action_type]) : row.action_type,
      row.provider,
      // El modelo es lo que fija el precio: sin él, "resumen con anthropic" no
      // dice si gastaste en Opus o en Haiku, que difieren 5x.
      row.model || '—',
      String(row.events),
      usd(row.total_micro_usd),
    ]
    cells.forEach((text, i) => {
      const td = document.createElement('td')
      td.textContent = text
      // El color identifica al proveedor, pero el nombre siempre está escrito:
      // la identidad nunca depende solo del color.
      if (i === 1) {
        const dot = document.createElement('span')
        dot.className = 'ct-dot'
        dot.style.background = PROVIDER_COLORS[row.provider] || cssVar('--text-3')
        td.prepend(dot)
      }
      tr.appendChild(td)
    })
    tbody.appendChild(tr)
  }
}

async function renderPricingStatus() {
  const status = await window.api.getPricingStatus()
  const when = status.lastFetched
    ? new Date(status.lastFetched).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })
    : 'nunca'
  const overrides = status.overrides > 0 ? ` · ${status.overrides} corregido(s) a mano` : ''
  document.getElementById('ct-pricing-status').textContent =
    `${status.models} modelos cotizados · última actualización: ${when}${overrides}`
}

async function render() {
  const summary = await window.api.getCostSummary({ groupBy, from: range.from, to: range.to })

  const hasData = summary.all_time_micro_usd > 0 || summary.unknown_cost_events > 0 || summary.by_action.length > 0
  document.getElementById('ct-empty').classList.toggle('hidden', hasData)
  document.getElementById('ct-content').classList.toggle('hidden', !hasData)
  if (!hasData) {
    chart?.destroy()
    chart = null
    return
  }

  document.getElementById('ct-range-total').textContent   = usd(summary.total_micro_usd)
  document.getElementById('ct-alltime-total').textContent = usd(summary.all_time_micro_usd)

  // Los eventos sin precio se muestran aparte: contarlos como $0 escondería gasto real.
  document.getElementById('ct-unknown').textContent = String(summary.unknown_cost_events)
  document.getElementById('ct-unknown-card').classList.toggle('ld-status-pending', summary.unknown_cost_events > 0)

  renderChart(summary)
  renderActionTable(summary)
  await renderPricingStatus()
}

export async function openCostsDashboard() {
  document.getElementById('content-panel').classList.add('hidden')
  document.getElementById('chat-panel').classList.add('hidden')
  // Los dashboards son excluyentes: entrar a Costos cierra Conocimiento, si no
  // los dos paneles quedan visibles a la vez partiendo la pantalla.
  document.getElementById('learning-panel').classList.add('hidden')
  document.getElementById('act-learning').classList.remove('active')

  document.getElementById('costs-panel').classList.remove('hidden')
  document.getElementById('act-costs').classList.add('active')
  await render()
}

export function closeCostsDashboard() {
  document.getElementById('costs-panel').classList.add('hidden')
  document.getElementById('content-panel').classList.remove('hidden')
  document.getElementById('chat-panel').classList.remove('hidden')
  document.getElementById('act-costs').classList.remove('active')
}

export function initCostsDashboard() {
  document.querySelectorAll('#ct-group-selector .range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.group === groupBy) return
      groupBy = btn.dataset.group
      document.querySelectorAll('#ct-group-selector .range-btn').forEach(b => b.classList.toggle('active', b === btn))
      render()
    })
  })

  // El rango de fechas es independiente de la granularidad: cambiar de Día a Mes
  // no pierde el rango elegido.
  const from = document.getElementById('ct-from')
  const to   = document.getElementById('ct-to')
  from.addEventListener('change', () => { range.from = from.value || null; render() })
  to.addEventListener('change',   () => { range.to   = to.value   || null; render() })

  document.getElementById('ct-clear-range').addEventListener('click', () => {
    range = { from: null, to: null }
    from.value = ''
    to.value = ''
    render()
  })

  document.getElementById('ct-refresh-pricing').addEventListener('click', async (e) => {
    const btn = e.currentTarget
    btn.disabled = true
    btn.textContent = t('actualizando')
    await window.api.refreshPricing()
    btn.disabled = false
    btn.textContent = t('actualizar-precios')
    await renderPricingStatus()
  })

  document.getElementById('btn-close-costs').addEventListener('click', closeCostsDashboard)
}