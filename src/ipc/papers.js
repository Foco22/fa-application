const fs   = require('fs')
const path = require('path')

async function runFetch({ db, deps, mainWindow }) {
  const {
    createLLM, createEmbeddings,
    fetchPapers, getAffiliations,
    downloadPdf, extractText, extractFirstPage,
    matchesUniversityInText, scoreAbstractAgainst,
    httpClient, pdfParse, vault
  } = deps

  const settings             = db.getAllSettings()
  const maxPapers            = parseInt(settings.maxPapers || '3', 10)
  const similarityThreshold  = parseFloat(settings.similarityThreshold || '0.72')
  const universityList       = (settings.universityList     || '').split('\n').map(s => s.trim()).filter(Boolean)
  const researchCenterList   = (settings.researchCenterList || '').split('\n').map(s => s.trim()).filter(Boolean)
  const orgFilter            = [...universityList, ...researchCenterList]
  const llm                  = settings.apiKey ? createLLM(settings)        : null
  const embProvider          = settings.apiKey ? createEmbeddings(settings)  : null

  const refEmbeddings = db.getReferencePapers().map(r => JSON.parse(r.embedding))

  const result = await fetchPapers(settings, httpClient)
  if (result.error) return { error: result.error }

  console.log(`[fetch] ${result.length} candidates from ArXiv. Saving up to ${maxPapers} that pass filters.`)
  if (refEmbeddings.length > 0) {
    console.log(`[fetch] Reference collection: ${refEmbeddings.length} papers (threshold: ${similarityThreshold})`)
  }

  const saved = []
  for (const paper of result) {
    if (saved.length >= maxPapers) break

    console.log(`\n[fetch] ── Paper: "${paper.title}" (${paper.id})`)

    if (embProvider && refEmbeddings.length > 0) {
      try {
        const score = await scoreAbstractAgainst(paper.abstract, refEmbeddings, embProvider)
        console.log(`[fetch]   Similarity: ${score.toFixed(3)} (threshold: ${similarityThreshold})`)
        if (score < similarityThreshold) {
          console.log(`[fetch]   REJECTED by similarity`)
          continue
        }
      } catch (embErr) {
        console.error(`[fetch]   Embeddings error: ${embErr.message}`)
        return { error: 'La API key de OpenAI es inválida o expiró. Actualízala en Configuración → API Key.' }
      }
    }

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

module.exports = { registerPapersHandlers, runFetch }
