const fs   = require('fs')
const path = require('path')

// Groups rendered in this order so the reader sees "what got saved" first,
// then the pipeline stages in the order a candidate actually passes through them.
const STAGE_SECTIONS = [
  { key: 'saved',             title: 'Guardados' },
  { key: 'selection',         title: 'Rechazados — filtro de interés (selección)' },
  { key: 'rerank_cap',        title: 'Rechazados — fuera del top pre-rerank' },
  { key: 'maxpapers_cutoff',  title: 'Rechazados — sobraron tras rerank (cupo de maxPapers)' },
  { key: 'download',          title: 'Rechazados — falló la descarga del PDF' },
  { key: 'first_page',        title: 'Rechazados — falló la extracción de la primera página' },
  { key: 'org_filter',        title: 'Rechazados — no coincide con universidades/centros' },
  { key: 'pending',           title: 'Sin filtro de interés configurado (pasan todos)' },
]

function groupKey(entry) {
  return entry.decision === 'saved' ? 'saved' : entry.stage
}

// Every candidate carries these fields regardless of how far it got in the
// pipeline (null = "never reached that stage") — rendered as explicit
// columns so a reader can see exactly which filter passed/failed per stage,
// instead of having to parse it out of the free-text `reason`.
function formatInterest(selection) {
  if (!selection) return 'sin filtro configurado'
  const { embSimRef, embSimInterest, kwRef, kwInterest, threshold } = selection
  return `embSimRef=${embSimRef.toFixed(3)}, embSimInterest=${embSimInterest.toFixed(3)} (umbral ${threshold}), kwRef=${kwRef}, kwInterest=${kwInterest}`
}

function formatRerank(rerank) {
  if (!rerank) return '—'
  return `#${rerank.rank} (score=${rerank.score.toFixed(3)})`
}

function formatDownload(download) {
  if (!download) return '—'
  return download.success ? 'OK' : `FALLÓ: ${download.error}`
}

function formatOrgFilter(orgFilter) {
  if (!orgFilter) return '—'
  if (!orgFilter.applied) return 'sin lista configurada'
  if (orgFilter.error) return `error 1ª página: ${orgFilter.error}`
  return orgFilter.passed ? 'PASA' : 'NO COINCIDE'
}

function renderTable(entries) {
  let md = '| Título | Autores | Universidad | Filtro interés | Rerank | Descarga PDF | Filtro universidad | Motivo |\n'
  md     += '|---|---|---|---|---|---|---|---|\n'
  for (const e of entries) {
    const title    = (e.title   || '(sin título)').replace(/\|/g, '\\|')
    const authors  = (e.authors || '—').replace(/\|/g, '\\|')
    const uni      = (e.university || '—').replace(/\|/g, '\\|')
    const interest = formatInterest(e.selection).replace(/\|/g, '\\|')
    const rerank   = formatRerank(e.rerank).replace(/\|/g, '\\|')
    const download = formatDownload(e.download).replace(/\|/g, '\\|')
    const orgFilter = formatOrgFilter(e.orgFilter).replace(/\|/g, '\\|')
    const reason   = (e.reason  || '—').replace(/\|/g, '\\|')
    md += `| ${title} | ${authors} | ${uni} | ${interest} | ${rerank} | ${download} | ${orgFilter} | ${reason} |\n`
  }
  return md
}

function renderMarkdown(report) {
  const { generatedAt, stats, entries } = report

  let md = `# Fetch log — ${generatedAt}\n\n`
  md += `Candidatos: ${stats.totalCandidates} · Seleccionados: ${stats.selected} · Guardados: ${stats.saved}\n\n`

  const grouped = new Map()
  for (const entry of entries) {
    const key = groupKey(entry)
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key).push(entry)
  }

  for (const { key, title } of STAGE_SECTIONS) {
    const group = grouped.get(key)
    if (!group || group.length === 0) continue
    md += `## ${title} (${group.length})\n\n`
    md += renderTable(group)
    md += '\n'
  }

  return md
}

function writeFetchLog(vaultDir, report) {
  const dir = path.join(vaultDir, 'fetch-logs')
  fs.mkdirSync(dir, { recursive: true })

  const stamp = report.generatedAt.replace(/[:.]/g, '-')
  const base  = path.join(dir, stamp)

  const jsonPath = `${base}.json`
  const mdPath   = `${base}.md`

  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8')
  fs.writeFileSync(mdPath, renderMarkdown(report), 'utf8')

  return { mdPath, jsonPath }
}

module.exports = { renderMarkdown, writeFetchLog }
