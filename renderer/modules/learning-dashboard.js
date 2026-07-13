const GOAL = 1

let charts = { weekly: null, weeklyPct: null, classPerf: null, quizPerf: null }
let currentRange = '8w'

function isoDate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function mondayOf(input) {
  const d = new Date(typeof input === 'string' ? `${input}T00:00:00` : input)
  const daysBack = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - daysBack)
  return isoDate(d)
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00`)
  d.setDate(d.getDate() + days)
  return isoDate(d)
}

// Same ISO-8601 week-number algorithm as renderer/modules/vault.js's isoWeek(),
// so chart labels match the "W27" folders shown in the vault tree.
function weekLabel(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`)
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
  const week1 = new Date(d.getFullYear(), 0, 4)
  const week = 1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7)
  return `W${String(week).padStart(2, '0')}`
}

function rangeToFromTo(range) {
  if (range === 'all') return {}
  const to = new Date()
  const from = new Date(to)
  if (range === '8w') from.setDate(from.getDate() - 8 * 7)
  else if (range === '3m') from.setMonth(from.getMonth() - 3)
  return { from: isoDate(from), to: isoDate(to) }
}

function lastNWeeksRange(n) {
  const to = new Date()
  const toIso = isoDate(to)
  return { from: mondayOf(addDays(toIso, -(n - 1) * 7)), to: toIso }
}

function weekRange(fromMonday, toMonday) {
  const weeks = []
  let cursor = fromMonday
  while (cursor <= toMonday) {
    weeks.push(cursor)
    cursor = addDays(cursor, 7)
  }
  return weeks
}

function avg(values) {
  const vals = values.filter(v => v != null)
  if (!vals.length) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

function fmt(n) {
  return n == null ? '—' : String(Math.round(n))
}

function destroyCharts() {
  Object.values(charts).forEach(c => c?.destroy())
  charts = { weekly: null, weeklyPct: null, classPerf: null, quizPerf: null }
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

// Draws each bar/point's value above it. Datasets can opt out via
// `skipLabels: true` (used by the "Meta" reference line).
const barValueLabelsPlugin = {
  id: 'barValueLabels',
  afterDatasetsDraw(chart) {
    const { ctx } = chart
    chart.data.datasets.forEach((dataset, datasetIndex) => {
      if (dataset.skipLabels) return
      const meta = chart.getDatasetMeta(datasetIndex)
      if (meta.hidden) return
      meta.data.forEach((bar, index) => {
        const value = dataset.data[index]
        if (value == null) return
        ctx.save()
        ctx.fillStyle = cssVar('--text')
        ctx.font = '700 13px ' + getComputedStyle(document.body).fontFamily
        ctx.textAlign = 'center'
        ctx.textBaseline = 'bottom'
        ctx.fillText(String(Math.round(value)), bar.x, bar.y - 5)
        ctx.restore()
      })
    })
  },
}

// Headroom above the tallest bar so its value label never crowds the legend.
function headroom(values) {
  const max = Math.max(0, ...values.filter(v => v != null))
  return max > 0 ? max * 1.25 : 1
}

function baseOptions(extra = {}) {
  const textColor = cssVar('--text-3')
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { intersect: false, mode: 'index' },
    layout: { padding: { top: 24 } },
    plugins: {
      legend: { labels: { color: cssVar('--text-2'), boxWidth: 10, font: { size: 11 } } },
    },
    scales: {
      x: { ticks: { color: textColor, font: { size: 10 } }, grid: { display: false } },
      y: { ticks: { color: textColor, font: { size: 10 } }, grid: { display: false }, beginAtZero: true },
    },
    ...extra,
  }
}

function renderStatRow(allWeeklyRows, last4WeeksRows) {
  const totalClasses = allWeeklyRows.reduce((sum, r) => sum + r.count, 0)
  document.getElementById('ld-total-classes').textContent = String(totalClasses)

  const thisWeek = mondayOf(new Date())
  const thisWeekCount = allWeeklyRows.find(r => r.week_start === thisWeek)?.count || 0
  const weekPct = Math.round((thisWeekCount / GOAL) * 100)
  const card = document.getElementById('ld-week-status-card')
  card.classList.toggle('ld-status-ok', weekPct >= 100)
  card.classList.toggle('ld-status-pending', weekPct < 100)
  document.getElementById('ld-week-pct').textContent = `${weekPct}%`

  const avg4w = avg(last4WeeksRows.map(r => r.avg_clarity))
  document.getElementById('ld-avg-4w').textContent = avg4w == null ? '—' : `${Math.round(avg4w)}%`
}

function weeksInRange(rows, from, to) {
  if (from && to) return weekRange(mondayOf(from), mondayOf(to))
  if (rows.length) return weekRange(rows[0].week_start, rows[rows.length - 1].week_start)
  return []
}

function renderWeeklyChart(rows, from, to) {
  const byWeek = new Map(rows.map(r => [r.week_start, r.count]))
  const weeks = weeksInRange(rows, from, to)
  const counts = weeks.map(w => byWeek.get(w) || 0)

  charts.weekly?.destroy()
  charts.weekly = new Chart(document.getElementById('ld-chart-weekly'), {
    data: {
      labels: weeks.map(weekLabel),
      datasets: [
        {
          type: 'bar',
          label: 'Clases',
          data: counts,
          backgroundColor: counts.map(c => c >= GOAL ? cssVar('--accent') : cssVar('--surface-3')),
          borderRadius: 4,
          order: 1,
        },
        {
          type: 'line',
          label: 'Meta',
          data: weeks.map(() => GOAL),
          borderColor: cssVar('--text'),
          borderDash: [4, 4],
          borderWidth: 2,
          pointRadius: 0,
          order: 2,
          skipLabels: true,
        },
      ],
    },
    options: baseOptions({
      scales: {
        x: baseOptions().scales.x,
        y: { ...baseOptions().scales.y, ticks: { ...baseOptions().scales.y.ticks, stepSize: 1 }, suggestedMax: headroom([...counts, GOAL]) },
      },
    }),
    plugins: [barValueLabelsPlugin],
  })
}

function renderWeeklyPctChart(rows, from, to) {
  const byWeek = new Map(rows.map(r => [r.week_start, r.count]))
  const weeks = weeksInRange(rows, from, to)
  const pct = weeks.map(w => Math.round(((byWeek.get(w) || 0) / GOAL) * 100))

  charts.weeklyPct?.destroy()
  charts.weeklyPct = new Chart(document.getElementById('ld-chart-weekly-pct'), {
    type: 'line',
    data: {
      labels: weeks.map(weekLabel),
      datasets: [
        {
          label: 'Cumplimiento %', data: pct,
          borderColor: cssVar('--accent'), backgroundColor: cssVar('--accent'),
          pointRadius: 4, pointHoverRadius: 5, tension: 0.25,
        },
      ],
    },
    options: baseOptions({ scales: { x: baseOptions().scales.x, y: { ...baseOptions().scales.y, suggestedMax: headroom(pct) } } }),
    plugins: [barValueLabelsPlugin],
  })
}

function renderClassPerfChart(rows) {
  const allValues = [...rows.map(r => r.avg_clarity), ...rows.map(r => r.avg_presentation), ...rows.map(r => r.avg_qa)]
  charts.classPerf?.destroy()
  charts.classPerf = new Chart(document.getElementById('ld-chart-class-perf'), {
    type: 'bar',
    data: {
      labels: rows.map(r => weekLabel(r.week_start)),
      datasets: [
        { label: 'Claridad', data: rows.map(r => r.avg_clarity), backgroundColor: cssVar('--accent'), borderRadius: 3 },
        { label: 'Exposición', data: rows.map(r => r.avg_presentation), backgroundColor: cssVar('--green'), borderRadius: 3 },
        { label: 'Q&A', data: rows.map(r => r.avg_qa), backgroundColor: cssVar('--text-3'), borderRadius: 3 },
      ],
    },
    options: baseOptions({ scales: { x: baseOptions().scales.x, y: { ...baseOptions().scales.y, suggestedMax: headroom(allValues) } } }),
    plugins: [barValueLabelsPlugin],
  })

  document.getElementById('ld-avg-clarity').textContent = fmt(avg(rows.map(r => r.avg_clarity)))
  document.getElementById('ld-avg-presentation').textContent = fmt(avg(rows.map(r => r.avg_presentation)))
  document.getElementById('ld-avg-qa').textContent = fmt(avg(rows.map(r => r.avg_qa)))
}

function renderQuizPerfChart(rows) {
  charts.quizPerf?.destroy()
  charts.quizPerf = new Chart(document.getElementById('ld-chart-quiz-perf'), {
    type: 'line',
    data: {
      labels: rows.map(r => weekLabel(r.week_start)),
      datasets: [
        {
          label: 'Acierto %', data: rows.map(r => r.avg_pct),
          borderColor: cssVar('--accent'), backgroundColor: cssVar('--accent'),
          pointRadius: 4, pointHoverRadius: 5, tension: 0.25,
        },
      ],
    },
    options: baseOptions({ scales: { x: baseOptions().scales.x, y: { ...baseOptions().scales.y, suggestedMax: headroom(rows.map(r => r.avg_pct)) } } }),
    plugins: [barValueLabelsPlugin],
  })

  const avgPct = avg(rows.map(r => r.avg_pct))
  document.getElementById('ld-avg-quiz').textContent = avgPct == null ? '—' : `${Math.round(avgPct)}%`
}

async function renderDashboard() {
  const [allWeekly, allQuiz] = await Promise.all([
    window.api.getWeeklyClassCounts({}),
    window.api.getQuizPerformanceTrend({}),
  ])
  const hasAnyData = allWeekly.length > 0 || allQuiz.length > 0

  document.getElementById('ld-empty').classList.toggle('hidden', hasAnyData)
  document.getElementById('ld-content').classList.toggle('hidden', !hasAnyData)
  if (!hasAnyData) {
    destroyCharts()
    return
  }

  const { from, to } = rangeToFromTo(currentRange)
  const last4w = lastNWeeksRange(4)
  const [weeklyRows, classRows, quizRows, last4WeeksRows] = await Promise.all([
    window.api.getWeeklyClassCounts({ from, to }),
    window.api.getClassPerformanceTrend({ from, to }),
    window.api.getQuizPerformanceTrend({ from, to }),
    window.api.getClassPerformanceTrend(last4w),
  ])

  renderStatRow(allWeekly, last4WeeksRows)
  renderWeeklyChart(weeklyRows, from, to)
  renderWeeklyPctChart(weeklyRows, from, to)
  renderClassPerfChart(classRows)
  renderQuizPerfChart(quizRows)
}

export async function openLearningDashboard() {
  document.getElementById('content-panel').classList.add('hidden')
  document.getElementById('chat-panel').classList.add('hidden')
  // Los dashboards son excluyentes: entrar a Conocimiento cierra Costos, si no
  // los dos paneles quedan visibles a la vez partiendo la pantalla.
  document.getElementById('costs-panel').classList.add('hidden')
  document.getElementById('act-costs').classList.remove('active')

  document.getElementById('learning-panel').classList.remove('hidden')
  document.getElementById('act-learning').classList.add('active')
  await renderDashboard()
}

export function closeLearningDashboard() {
  document.getElementById('learning-panel').classList.add('hidden')
  document.getElementById('content-panel').classList.remove('hidden')
  document.getElementById('chat-panel').classList.remove('hidden')
  document.getElementById('act-learning').classList.remove('active')
}

export function initLearningDashboard() {
  document.querySelectorAll('#ld-range-selector .range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.range === currentRange) return
      currentRange = btn.dataset.range
      document.querySelectorAll('#ld-range-selector .range-btn').forEach(b => b.classList.toggle('active', b === btn))
      renderDashboard()
    })
  })
  document.getElementById('btn-close-learning').addEventListener('click', closeLearningDashboard)
}
