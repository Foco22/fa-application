const fs   = require('fs')
const path = require('path')
const { diagnoseEmptyFetch } = require('../ingestion/fetchLog')
const { emptyFetchMessage }  = require('../notifications')
const { embedMany }          = require('../embeddings')
const { createProgressEmitter } = require('./progress')
const { papersOfThisWeek, hasUserData } = require('../ingestion/week')

// Selection phase: scores every ArXiv candidate against two independent
// interest signals (reference collection, declared keywordList). When
// embeddings are available they DECIDE: a candidate survives only if its
// similarity to the references or to a declared keyword clears the threshold.
// A literal keyword hit never admits a paper on its own — generic keywords
// ("agent", "memory") hit off-topic abstracts — it only boosts the ranking of
// papers that already passed. Literal match decides only as a fallback when no
// embedding could be computed (no provider, or only stale vectors).
//
// Every survivor goes to the rerank — no pre-cap. The cross-encoder is
// local/free (only cost is time, and this runs weekly in background), and a
// fixed pre-cut using a cruder embedding score could throw away a candidate
// before the more accurate model ever saw it (v3, see plan.md).
const RERANK_CAP = 100

function makeReportEntry(paper) {
  return {
    id: paper.id,
    title: paper.title,
    authors: paper.authors,
    university: null,
    selection: null,
    rerank: null,
    download: null,
    orgFilter: null,
    stage: 'selection',
    decision: 'pending',
    reason: '',
  }
}

async function selectCandidates(candidates, { db, deps, settings, embProvider, similarityThreshold, onProgress = () => {} }) {
  const { scoreEmbeddingAgainst, embedKeywordList, keywordOverlap, createReranker } = deps

  const refRows = db.getReferencePapers()

  // Sólo son comparables los vectores del modelo activo: los de otro modelo ni
  // siquiera comparten dimensión, y mezclarlos daría similitudes basura. Se
  // ignoran hasta que el usuario reindexe. Los resúmenes son texto, así que
  // siguen sirviendo para el rerank aunque el índice haya quedado obsoleto.
  const refEmbeddings = refRows
    .filter(r => r.embedding_model === embProvider?.id)
    .map(r => JSON.parse(r.embedding))
  const refSummaries  = refRows.map(r => r.abstract_summary).filter(Boolean)

  const declaredKeywords = (settings.keywordList || '').split('\n').map(s => s.trim()).filter(Boolean)
  const keywordEmbeddings = embProvider ? await embedKeywordList(settings.keywordList, embProvider) : []

  const report = candidates.map(makeReportEntry)
  const entryById = new Map(report.map(e => [e.id, e]))

  const hasInterestSignal = refRows.length > 0 || declaredKeywords.length > 0
  if (!hasInterestSignal) {
    for (const entry of report) {
      entry.reason = 'Sin colección de referencia ni keywordList configurados — pasa sin filtrar'
    }
    return { survivors: candidates, rerankQueries: [], report }
  }

  // Todos los abstracts se embeben de una vez (por lotes si el proveedor lo
  // soporta): con miles de candidatos, una llamada de red por paper era lo que
  // más tardaba del fetch.
  const needsEmbedding = embProvider && (refEmbeddings.length > 0 || keywordEmbeddings.length > 0)
  let abstractEmbeddings = []
  if (needsEmbedding) {
    // Los eventos de inicio y fin se emiten siempre: el proveedor puede no
    // reportar avance intermedio y la barra no debe quedarse sin esta etapa.
    onProgress('embedding', 0, candidates.length)
    abstractEmbeddings = await embedMany(embProvider, candidates.map(c => c.abstract), (done, total) => onProgress('embedding', done, total))
    onProgress('embedding', candidates.length, candidates.length)
  }

  const scored = []
  for (const [i, paper] of candidates.entries()) {
    const entry = entryById.get(paper.id)
    let embSimRef = 0, embSimInterest = 0

    if (needsEmbedding) {
      const abstractEmbedding = abstractEmbeddings[i]
      if (refEmbeddings.length > 0)      embSimRef      = scoreEmbeddingAgainst(abstractEmbedding, refEmbeddings)
      if (keywordEmbeddings.length > 0)  embSimInterest = scoreEmbeddingAgainst(abstractEmbedding, keywordEmbeddings.map(k => k.embedding))
    }

    const kwInterest = declaredKeywords.length > 0 ? keywordOverlap(paper.abstract, declaredKeywords) : false

    const passes = needsEmbedding
      ? embSimRef >= similarityThreshold || embSimInterest >= similarityThreshold
      : kwInterest

    entry.selection = { embSimRef, embSimInterest, kwInterest, threshold: similarityThreshold, passed: passes }

    if (!passes) {
      entry.decision = 'rejected'
      entry.reason = `No superó ningún filtro de interés (embSimRef=${embSimRef.toFixed(3)}, embSimInterest=${embSimInterest.toFixed(3)}, umbral=${similarityThreshold}, kwInterest=${kwInterest}${needsEmbedding ? ' — las keywords no alcanzan por sí solas' : ''})`
      continue
    }

    const rankScore = Math.max(embSimRef, embSimInterest) + (kwInterest ? 0.1 : 0)
    scored.push({ paper, rankScore, entry })
  }

  scored.sort((a, b) => b.rankScore - a.rankScore)

  // El cross-encoder corre en el proceso principal y cuesta (queries × documentos)
  // inferencias: con el pool de una semana completa pasaban ~2.000 candidatos y la
  // app quedaba colgada. Solo los mejores por similitud llegan al rerank; el resto
  // queda en el log, y como siguen ordenados por rankScore no se pierde el orden.
  if (scored.length > RERANK_CAP) {
    for (const { entry } of scored.slice(RERANK_CAP)) {
      entry.stage = 'rerank_cap'
      entry.decision = 'rejected'
      entry.reason = `Pasó el filtro de interés pero quedó fuera del top ${RERANK_CAP} previo al rerank`
    }
    scored.length = RERANK_CAP
  }

  // Una query por interés, no una sola concatenada: el cross-encoder trunca a su
  // límite de tokens y cortaba justo las keywords del final. El reranker se queda
  // con el mejor score de cada documento entre todas las queries.
  const rerankQueries = [...refSummaries, declaredKeywords.join(', ')].filter(Boolean)

  if (scored.length === 0 || rerankQueries.length === 0) {
    for (const { entry } of scored) {
      entry.reason = 'Pasó el filtro de interés; sin rerank (no hay rerankQueries)'
    }
    return { survivors: scored.map(s => s.paper), rerankQueries, report }
  }

  const reranker = createReranker()
  onProgress('rerank', 0, scored.length)
  const ranked = await reranker.rerank(rerankQueries, scored.map(s => s.paper.abstract), (done, total) => onProgress('rerank', done, total))
  onProgress('rerank', scored.length, scored.length)
  ranked.forEach((r, i) => {
    const { entry } = scored[r.index]
    entry.rerank = { rank: i + 1, score: r.score }
    entry.reason = `Pasó el filtro de interés y el rerank (posición ${i + 1}, score=${r.score.toFixed(3)})`
  })

  return { survivors: ranked.map(r => scored[r.index].paper), rerankQueries, report }
}

// maxPapers es un tope SEMANAL: lo que ya se trajo esta semana descuenta del cupo.
// Con replaceWeek el usuario aceptó reemplazar esos papers, así que el cupo vuelve
// a ser completo; los anteriores se borran SOLO si la nueva corrida guardó algo.
async function runFetch({ db, deps, mainWindow, replaceWeek = false }) {
  const {
    createLLM, createEmbeddings, hasEmbeddingConfig,
    fetchPapers, getAffiliations,
    downloadPdf, extractText, extractFirstPage,
    matchesUniversityInText,
    httpClient, pdfParse, vault, writeFetchLog
  } = deps

  const settings             = db.getAllSettings()
  const maxPapers            = parseInt(settings.maxPapers || '3', 10)
  const similarityThreshold  = parseFloat(settings.similarityThreshold || '0.6')
  const universityList       = (settings.universityList     || '').split('\n').map(s => s.trim()).filter(Boolean)
  const researchCenterList   = (settings.researchCenterList || '').split('\n').map(s => s.trim()).filter(Boolean)
  const orgFilter            = [...universityList, ...researchCenterList]
  const llm                  = settings.apiKey            ? createLLM(settings)        : null
  // El proveedor local no necesita API key — no se puede gatear por settings.apiKey.
  const embProvider          = hasEmbeddingConfig(settings) ? createEmbeddings(settings) : null

  const weekPapers = papersOfThisWeek(db.getPapers())
  const quota      = replaceWeek ? maxPapers : maxPapers - weekPapers.length
  if (quota <= 0) {
    const outcome = { code: 'week_full', count: weekPapers.length, max: maxPapers }
    return { saved: [], empty: { ...outcome, message: emptyFetchMessage(outcome, settings.language) } }
  }

  const progress = createProgressEmitter(mainWindow)

  // `undefined` en today/sleepFn → fetchPapers usa sus valores por defecto.
  const result = await fetchPapers(settings, httpClient, undefined, undefined,
    ({ loaded, total }) => progress('arxiv', loaded, total ?? loaded))
  if (result.error) return { error: result.error }

  console.log(`[fetch] ${result.length} candidates from ArXiv.`)

  let survivors, report
  try {
    const selection = await selectCandidates(result, { db, deps, settings, embProvider, similarityThreshold, onProgress: progress })
    survivors = selection.survivors
    report    = selection.report
  } catch (embErr) {
    console.error(`[fetch]   Selection phase error: ${embErr.message}`)
    return { error: `Error al filtrar candidatos: ${embErr.message}. Si el problema persiste, revisá tu API key de OpenAI en Configuración.` }
  }

  const entryById = new Map(report.map(e => [e.id, e]))

  console.log(`[fetch] ${survivors.length} candidates survived filter + rerank. Saving up to ${quota}.`)

  const saved = []

  async function finalizeSave(paper, entry, buf, aiAffiliations, matchedAffiliation) {
    const ssAffiliations = await getAffiliations(paper.id, httpClient, settings.semanticScholarApiKey)
    let affiliationsJson = null
    if (ssAffiliations && ssAffiliations.length > 0) {
      affiliationsJson = JSON.stringify(ssAffiliations)
      const ssUniversities = ssAffiliations.flatMap(a => a.affiliations || []).filter(Boolean)
      if (ssUniversities.length > 0) entry.university = ssUniversities.join('; ')
    } else if (aiAffiliations && aiAffiliations.length > 0) {
      affiliationsJson = JSON.stringify(aiAffiliations.map(a => ({ name: '', affiliations: [a] })))
    }

    const extracted   = await extractText(buf, pdfParse)
    const finalPaper  = {
      ...paper,
      affiliations: affiliationsJson,
      // NULL = no se evaluó (sin universityList/researchCenterList configurado,
      // o falló extractFirstPage) — no es lo mismo que 0 (se evaluó, no matcheó).
      matched_affiliation: matchedAffiliation === null ? null : (matchedAffiliation ? 1 : 0),
      pdf_text:     extracted.success ? extracted.text : null,
      // La ingesta SIEMPRE usa pdf-parse liviano — el OCR es una acción posterior
      // y explícita del usuario, nunca parte del fetch (§4/§8 del PRD).
      pdf_text_source: 'pdf-parse',
      status:       extracted.success ? 'ready' : 'pdf_error',
      pdf_error:    extracted.success ? null : extracted.error
    }
    db.savePaper(finalPaper)
    saved.push(finalPaper)
    progress('saving', saved.length, quota)
    entry.stage = 'saved'
    entry.decision = 'saved'
    entry.reason = `Guardado (status: ${finalPaper.status})`
    console.log(`[fetch]   SAVED (status: ${finalPaper.status}, afiliación: ${matchedAffiliation === true ? 'match' : matchedAffiliation === false ? 'sin match' : 'no evaluada'})`)
  }

  // La afiliación (universityList/researchCenterList) ya NO rechaza candidatos —
  // solo se guarda como matched_affiliation para que la UI la muestre como
  // estrella. Todo candidato que llega hasta acá (pasó interés + rerank + tiene
  // PDF descargado) se guarda, con o sin match (v3, ver plan.md).
  // El cupo de maxPapers se aplica sobre los papers GUARDADOS, no sobre los
  // sobrevivientes: si un PDF falla, se sigue con el siguiente en el ranking.
  progress('saving', 0, quota)
  for (const paper of survivors) {
    if (saved.length >= quota) break
    const entry = entryById.get(paper.id)
    console.log(`\n[fetch] ── Paper: "${paper.title}" (${paper.id})`)

    vault.ensureDirs(paper)
    const dl = await downloadPdf(paper.id, paper.pdf_url, httpClient, path.dirname(vault.pdfPath(paper)))
    entry.download = { success: dl.success, error: dl.success ? null : dl.error }
    if (!dl.success) {
      console.log(`[fetch]   PDF download FAILED: ${dl.error}`)
      entry.stage = 'download'
      entry.decision = 'rejected'
      entry.reason = `Falló la descarga del PDF: ${dl.error}`
      continue
    }
    console.log(`[fetch]   PDF downloaded OK`)

    const buf       = fs.readFileSync(dl.path)
    const firstPage = await extractFirstPage(buf, pdfParse)
    let aiAffiliations = null
    let matchedAffiliation = null

    if (firstPage.success) {
      if (llm) {
        aiAffiliations = await llm.extractAffiliationsWithAI(firstPage.text)
        console.log(`[fetch]   AI affiliations: ${JSON.stringify(aiAffiliations)}`)
      }
      if (aiAffiliations && aiAffiliations.length > 0) entry.university = aiAffiliations.join('; ')

      if (orgFilter.length > 0) {
        matchedAffiliation = aiAffiliations
          ? aiAffiliations.some(a => {
              const segments = a.split(',').map(s => s.trim().toLowerCase())
              return orgFilter.some(u => {
                const ul = u.toLowerCase()
                return segments.some(seg => seg.includes(ul) || ul.includes(seg))
              })
            })
          : matchesUniversityInText(firstPage.text, orgFilter)
        console.log(`[fetch]   Org match: ${matchedAffiliation ? 'YES' : 'no'}`)
        entry.orgFilter = { applied: true, affiliations: aiAffiliations, passed: matchedAffiliation }
      } else {
        entry.orgFilter = { applied: false }
      }
    } else {
      console.log(`[fetch]   First-page extract FAILED: ${firstPage.error} — se guarda igual, sin afiliación`)
      entry.orgFilter = { applied: orgFilter.length > 0, error: firstPage.error, passed: false }
    }

    await finalizeSave(paper, entry, buf, aiAffiliations, matchedAffiliation)
  }

  // Sobrevivientes que ni se intentaron porque el cupo ya se llenó.
  for (const entry of report.filter(e => e.decision === 'pending')) {
    entry.stage = 'maxpapers_cutoff'
    entry.decision = 'rejected'
    entry.reason = `Sobrevivió selección/rerank pero no entró en el cupo semanal (${quota} libres de ${maxPapers})`
  }

  // Reemplazo de la semana: recién ahora, con los nuevos ya guardados, se borran los
  // anteriores (si la corrida no guardó nada, la semana no se deja vacía). Un paper
  // elegido otra vez se salta: borrarlo eliminaría la copia nueva.
  if (replaceWeek && saved.length > 0) {
    const keepIds = new Set(saved.map(p => p.id))
    for (const old of weekPapers) {
      if (keepIds.has(old.id)) continue
      try { vault.deletePaperDir(old) } catch (_) {}
      db.deletePaper(old.id)
    }
  }

  const stats = { totalCandidates: result.length, selected: survivors.length, saved: saved.length }

  if (writeFetchLog) {
    const fetchReport = {
      generatedAt: new Date().toISOString(),
      stats,
      entries: report,
    }
    try {
      writeFetchLog(fetchReport)
    } catch (logErr) {
      console.error(`[fetch]   Failed to write fetch log: ${logErr.message}`)
    }
  }

  if (saved.length === 0) {
    // Un fetch que no guarda nada no debe fallar en silencio: se devuelve el motivo.
    const outcome = diagnoseEmptyFetch({ stats, entries: report, threshold: similarityThreshold })
    return { saved: [], empty: { ...outcome, message: emptyFetchMessage(outcome, settings.language) } }
  }

  if (mainWindow) mainWindow.webContents.send('new-papers', saved.length)
  return saved
}

function registerPapersHandlers({ ipcMain, db, deps, mainWindow }) {
  const { vault, pdfsDir } = deps
  const fs = require('fs')

  ipcMain.handle('get-papers', () => db.getPapers())

  ipcMain.handle('get-paper', (_e, id) => db.getPaper(id))

  // `replaceWeek` solo llega true si el usuario confirmó el modal de reemplazo.
  ipcMain.handle('fetch-papers', (_e, opts) => runFetch({ db, deps, mainWindow, replaceWeek: Boolean(opts?.replaceWeek) }))

  // Lo que la UI necesita para preguntar ANTES de lanzar el fetch.
  ipcMain.handle('get-week-status', () => {
    const settings = db.getAllSettings()
    const papers   = papersOfThisWeek(db.getPapers())
    return {
      count: papers.length,
      max:   parseInt(settings.maxPapers || '3', 10),
      papers: papers.map(p => ({ id: p.id, title: p.title, hasUserData: hasUserData(p) })),
    }
  })

  ipcMain.handle('save-notes', (_e, { paperId, notes }) => {
    db.saveNotes(paperId, notes)
    return { success: true }
  })

  ipcMain.handle('save-highlights', (_e, { paperId, highlights }) => {
    db.saveHighlights(paperId, highlights)
    return { success: true }
  })

  ipcMain.handle('delete-paper', (_e, id) => {
    const paper = db.getPaper(id)
    if (paper) {
      try { vault.deletePaperDir(paper) } catch (_) {}
    }
    db.deletePaper(id)
    return { success: true }
  })

  ipcMain.handle('get-pdf-url', (_e, paperId) => {
    const paper = db.getPaper(paperId)
    if (paper) {
      const vaultPdf = vault.pdfPath(paper)
      if (fs.existsSync(vaultPdf)) return `file://${vaultPdf}`
      if (paper.pdf_url && !paper.pdf_url.startsWith('http') && fs.existsSync(paper.pdf_url)) {
        return `file://${paper.pdf_url}`
      }
    }
    const legacyPdf = require('path').join(pdfsDir, `${paperId}.pdf`)
    if (fs.existsSync(legacyPdf)) return `file://${legacyPdf}`
    return null
  })
}

module.exports = { registerPapersHandlers, runFetch, selectCandidates, RERANK_CAP }
