const fs   = require('fs')
const path = require('path')

// Selection phase: scores every ArXiv candidate against two independent
// interest signals (reference collection, declared keywordList), each
// evaluated with hybrid search (embedding similarity + literal keyword
// match). A candidate survives if ANY of the 4 signals clears its bar — see
// INGESTA.md "v2 — Rediseño" for the full rationale.
//
// Every survivor goes to the rerank — no pre-cap. The cross-encoder is
// local/free (only cost is time, and this runs weekly in background), and a
// fixed pre-cut using a cruder embedding score could throw away a candidate
// before the more accurate model ever saw it (v3, see plan.md).
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

async function selectCandidates(candidates, { db, deps, settings, embProvider, similarityThreshold }) {
  const { scoreEmbeddingAgainst, embedKeywordList, extractKeywords, keywordOverlap, createReranker } = deps

  const refRows = db.getReferencePapers()

  // Sólo son comparables los vectores del modelo activo: los de otro modelo ni
  // siquiera comparten dimensión, y mezclarlos daría similitudes basura. Se
  // ignoran hasta que el usuario reindexe. Keywords y resúmenes son texto, así
  // que siguen sirviendo aunque el índice haya quedado obsoleto.
  const refEmbeddings = refRows
    .filter(r => r.embedding_model === embProvider?.id)
    .map(r => JSON.parse(r.embedding))
  const refKeywords   = refRows.flatMap(r => extractKeywords(r.snippet || ''))
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
    return { survivors: candidates, rerankQuery: '', report }
  }

  const scored = []
  for (const paper of candidates) {
    const entry = entryById.get(paper.id)
    let embSimRef = 0, embSimInterest = 0

    const needsEmbedding = embProvider && (refEmbeddings.length > 0 || keywordEmbeddings.length > 0)
    if (needsEmbedding) {
      const abstractEmbedding = await embProvider.generateEmbedding(paper.abstract)
      if (refEmbeddings.length > 0)      embSimRef      = scoreEmbeddingAgainst(abstractEmbedding, refEmbeddings)
      if (keywordEmbeddings.length > 0)  embSimInterest = scoreEmbeddingAgainst(abstractEmbedding, keywordEmbeddings.map(k => k.embedding))
    }

    const kwRef      = refKeywords.length > 0      ? keywordOverlap(paper.abstract, refKeywords)      : false
    const kwInterest = declaredKeywords.length > 0  ? keywordOverlap(paper.abstract, declaredKeywords)  : false

    const passes = embSimRef >= similarityThreshold || kwRef ||
                   embSimInterest >= similarityThreshold || kwInterest

    entry.selection = { embSimRef, embSimInterest, kwRef, kwInterest, threshold: similarityThreshold, passed: passes }

    if (!passes) {
      entry.decision = 'rejected'
      entry.reason = `No superó ningún filtro de interés (embSimRef=${embSimRef.toFixed(3)}, embSimInterest=${embSimInterest.toFixed(3)}, umbral=${similarityThreshold}, kwRef=${kwRef}, kwInterest=${kwInterest})`
      continue
    }

    const rankScore = Math.max(embSimRef, embSimInterest) + (kwRef || kwInterest ? 0.1 : 0)
    scored.push({ paper, rankScore, entry })
  }

  scored.sort((a, b) => b.rankScore - a.rankScore)

  const rerankQuery = [...refSummaries, ...declaredKeywords].join('. ')

  if (scored.length === 0 || !rerankQuery) {
    for (const { entry } of scored) {
      entry.reason = 'Pasó el filtro de interés; sin rerank (no hay rerankQuery)'
    }
    return { survivors: scored.map(s => s.paper), rerankQuery, report }
  }

  const reranker = createReranker()
  const ranked = await reranker.rerank(rerankQuery, scored.map(s => s.paper.abstract))
  ranked.forEach((r, i) => {
    const { entry } = scored[r.index]
    entry.rerank = { rank: i + 1, score: r.score }
    entry.reason = `Pasó el filtro de interés y el rerank (posición ${i + 1}, score=${r.score.toFixed(3)})`
  })

  return { survivors: ranked.map(r => scored[r.index].paper), rerankQuery, report }
}

async function runFetch({ db, deps, mainWindow }) {
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

  const result = await fetchPapers(settings, httpClient)
  if (result.error) return { error: result.error }

  console.log(`[fetch] ${result.length} candidates from ArXiv.`)

  let selected, report
  try {
    const selection = await selectCandidates(result, { db, deps, settings, embProvider, similarityThreshold })
    selected = selection.survivors.slice(0, maxPapers)
    report   = selection.report
  } catch (embErr) {
    console.error(`[fetch]   Selection phase error: ${embErr.message}`)
    return { error: `Error al filtrar candidatos: ${embErr.message}. Si el problema persiste, revisá tu API key de OpenAI en Configuración.` }
  }

  const entryById = new Map(report.map(e => [e.id, e]))

  const overflow = report.filter(e =>
    e.decision === 'pending' && !selected.some(p => p.id === e.id)
  )
  for (const entry of overflow) {
    entry.stage = 'maxpapers_cutoff'
    entry.decision = 'rejected'
    entry.reason = `Sobrevivió selección/rerank pero no entró en el cupo de maxPapers=${maxPapers}`
  }

  console.log(`[fetch] ${selected.length} candidates selected after filter + rerank. Processing up to ${maxPapers}.`)

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
    entry.stage = 'saved'
    entry.decision = 'saved'
    entry.reason = `Guardado (status: ${finalPaper.status})`
    console.log(`[fetch]   SAVED (status: ${finalPaper.status}, afiliación: ${matchedAffiliation === true ? 'match' : matchedAffiliation === false ? 'sin match' : 'no evaluada'})`)
  }

  // La afiliación (universityList/researchCenterList) ya NO rechaza candidatos —
  // solo se guarda como matched_affiliation para que la UI la muestre como
  // estrella. Todo candidato que llega hasta acá (pasó interés + rerank + tiene
  // PDF descargado) se guarda, con o sin match (v3, ver plan.md).
  for (const paper of selected) {
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

  if (writeFetchLog) {
    const fetchReport = {
      generatedAt: new Date().toISOString(),
      stats: { totalCandidates: result.length, selected: selected.length, saved: saved.length },
      entries: report,
    }
    try {
      writeFetchLog(fetchReport)
    } catch (logErr) {
      console.error(`[fetch]   Failed to write fetch log: ${logErr.message}`)
    }
  }

  if (mainWindow && saved.length > 0) {
    mainWindow.webContents.send('new-papers', saved.length)
  }
  return saved
}

function registerPapersHandlers({ ipcMain, db, deps, mainWindow }) {
  const { vault, pdfsDir } = deps
  const fs = require('fs')

  ipcMain.handle('get-papers', () => db.getPapers())

  ipcMain.handle('get-paper', (_e, id) => db.getPaper(id))

  ipcMain.handle('fetch-papers', () => runFetch({ db, deps, mainWindow }))

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

module.exports = { registerPapersHandlers, runFetch, selectCandidates }
