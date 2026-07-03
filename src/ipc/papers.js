const fs   = require('fs')
const path = require('path')

const PRERANK_CAP = 15 // candidates handed to the cross-encoder rerank per fetch

// Selection phase: scores every ArXiv candidate against two independent
// interest signals (reference collection, declared keywordList), each
// evaluated with hybrid search (embedding similarity + literal keyword
// match). A candidate survives if ANY of the 4 signals clears its bar — see
// INGESTA.md "v2 — Rediseño" for the full rationale.
async function selectCandidates(candidates, { db, deps, settings, embProvider, similarityThreshold }) {
  const { scoreEmbeddingAgainst, embedKeywordList, extractKeywords, keywordOverlap, createReranker } = deps

  const refRows       = db.getReferencePapers()
  const refEmbeddings = refRows.map(r => JSON.parse(r.embedding))
  const refKeywords   = refRows.flatMap(r => extractKeywords(r.snippet || ''))
  const refSummaries  = refRows.map(r => r.abstract_summary).filter(Boolean)

  const declaredKeywords = (settings.keywordList || '').split('\n').map(s => s.trim()).filter(Boolean)
  const keywordEmbeddings = embProvider ? await embedKeywordList(settings.keywordList, embProvider) : []

  const hasInterestSignal = refRows.length > 0 || declaredKeywords.length > 0
  if (!hasInterestSignal) return { survivors: candidates, rerankQuery: '' }

  const scored = []
  for (const paper of candidates) {
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

    if (!passes) continue

    const rankScore = Math.max(embSimRef, embSimInterest) + (kwRef || kwInterest ? 0.1 : 0)
    scored.push({ paper, rankScore })
  }

  const preRanked = scored.sort((a, b) => b.rankScore - a.rankScore).slice(0, PRERANK_CAP)
  const rerankQuery = [...refSummaries, ...declaredKeywords].join('. ')

  if (preRanked.length === 0 || !rerankQuery) {
    return { survivors: preRanked.map(s => s.paper), rerankQuery }
  }

  const reranker = createReranker()
  const ranked = await reranker.rerank(rerankQuery, preRanked.map(s => s.paper.abstract))
  return { survivors: ranked.map(r => preRanked[r.index].paper), rerankQuery }
}

async function runFetch({ db, deps, mainWindow }) {
  const {
    createLLM, createEmbeddings,
    fetchPapers, getAffiliations,
    downloadPdf, extractText, extractFirstPage,
    matchesUniversityInText,
    httpClient, pdfParse, vault
  } = deps

  const settings             = db.getAllSettings()
  const maxPapers            = parseInt(settings.maxPapers || '3', 10)
  const similarityThreshold  = parseFloat(settings.similarityThreshold || '0.6')
  const universityList       = (settings.universityList     || '').split('\n').map(s => s.trim()).filter(Boolean)
  const researchCenterList   = (settings.researchCenterList || '').split('\n').map(s => s.trim()).filter(Boolean)
  const orgFilter            = [...universityList, ...researchCenterList]
  const llm                  = settings.apiKey ? createLLM(settings)        : null
  const embProvider          = settings.apiKey ? createEmbeddings(settings)  : null

  const result = await fetchPapers(settings, httpClient)
  if (result.error) return { error: result.error }

  console.log(`[fetch] ${result.length} candidates from ArXiv.`)

  let selected
  try {
    const { survivors } = await selectCandidates(result, { db, deps, settings, embProvider, similarityThreshold })
    selected = survivors.slice(0, maxPapers)
  } catch (embErr) {
    console.error(`[fetch]   Selection phase error: ${embErr.message}`)
    return { error: `Error al filtrar candidatos: ${embErr.message}. Si el problema persiste, revisá tu API key de OpenAI en Configuración.` }
  }

  console.log(`[fetch] ${selected.length} candidates selected after filter + rerank. Processing up to ${maxPapers}.`)

  const saved = []
  for (const paper of selected) {
    console.log(`\n[fetch] ── Paper: "${paper.title}" (${paper.id})`)

    vault.ensureDirs(paper)
    const dl = await downloadPdf(paper.id, paper.pdf_url, httpClient, path.dirname(vault.pdfPath(paper)))
    if (!dl.success) {
      console.log(`[fetch]   PDF download FAILED: ${dl.error}`)
      continue
    }
    console.log(`[fetch]   PDF downloaded OK`)

    const buf       = fs.readFileSync(dl.path)
    const firstPage = await extractFirstPage(buf, pdfParse)
    let aiAffiliations = null

    if (firstPage.success) {
      if (llm) {
        aiAffiliations = await llm.extractAffiliationsWithAI(firstPage.text)
        console.log(`[fetch]   AI affiliations: ${JSON.stringify(aiAffiliations)}`)
      }

      if (orgFilter.length > 0) {
        const passes = aiAffiliations
          ? aiAffiliations.some(a => {
              const segments = a.split(',').map(s => s.trim().toLowerCase())
              return orgFilter.some(u => {
                const ul = u.toLowerCase()
                return segments.some(seg => seg.includes(ul) || ul.includes(seg))
              })
            })
          : matchesUniversityInText(firstPage.text, orgFilter)
        console.log(`[fetch]   Org match: ${passes ? 'PASS' : 'REJECTED'}`)
        if (!passes) {
          fs.unlinkSync(dl.path)
          continue
        }
      }
    } else if (orgFilter.length > 0) {
      console.log(`[fetch]   First-page extract FAILED: ${firstPage.error} → REJECTED`)
      fs.unlinkSync(dl.path)
      continue
    }

    const ssAffiliations = await getAffiliations(paper.id, httpClient, settings.semanticScholarApiKey)
    let affiliationsJson = null
    if (ssAffiliations && ssAffiliations.length > 0) {
      affiliationsJson = JSON.stringify(ssAffiliations)
    } else if (aiAffiliations && aiAffiliations.length > 0) {
      affiliationsJson = JSON.stringify(aiAffiliations.map(a => ({ name: '', affiliations: [a] })))
    }

    const extracted   = await extractText(buf, pdfParse)
    const finalPaper  = {
      ...paper,
      affiliations: affiliationsJson,
      pdf_text:     extracted.success ? extracted.text : null,
      status:       extracted.success ? 'ready' : 'pdf_error',
      pdf_error:    extracted.success ? null : extracted.error
    }
    db.savePaper(finalPaper)
    saved.push(finalPaper)
    console.log(`[fetch]   SAVED (status: ${finalPaper.status})`)
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

module.exports = { registerPapersHandlers, runFetch, selectCandidates, PRERANK_CAP }
