const fs   = require('fs')
const path = require('path')

function registerReferenceHandlers({ ipcMain, db, deps }) {
  const {
    shell, dialog,
    createLLM, createEmbeddings,
    indexReferenceFolder, extractFirstPage, extractText,
    pdfParse, vault
  } = deps

  ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('open-vault-folder', () => {
    shell.openPath(vault.dir)
  })

  ipcMain.handle('open-reference-folder', () => {
    const folder = db.getSetting('referenceFolderPath')
    if (folder) shell.openPath(folder)
    return !!folder
  })

  ipcMain.handle('open-file', (_e, filePath) => {
    shell.openPath(filePath)
  })

  ipcMain.handle('get-reference-stats', () => ({ total: db.getReferenceCount() }))

  ipcMain.handle('index-reference-folder', async () => {
    const settings = db.getAllSettings()
    if (!settings.apiKey || !settings.referenceFolderPath) {
      return { indexed: 0, errors: 0, total: db.getReferenceCount() }
    }
    const embProvider = createEmbeddings(settings)
    const llm         = createLLM(settings)
    const res = await indexReferenceFolder(settings.referenceFolderPath, db, embProvider, pdfParse, llm)
    return { ...res, total: db.getReferenceCount() }
  })

  ipcMain.handle('index-files', async (_e, filePaths) => {
    const settings = db.getAllSettings()
    if (!settings.apiKey) return { indexed: 0, errors: filePaths.length, total: db.getReferenceCount() }
    const llm         = createLLM(settings)
    const embProvider = createEmbeddings(settings)

    let indexed = 0, errors = 0

    for (const filePath of filePaths) {
      if (!filePath.toLowerCase().endsWith('.pdf')) continue
      try {
        const buf       = fs.readFileSync(filePath)
        const firstPage = await extractFirstPage(buf, pdfParse)
        const extracted = await extractText(buf, pdfParse)

        const snippet  = firstPage.success ? firstPage.text : (extracted.text || '').slice(0, 3000)
        const meta     = firstPage.success ? await llm.extractPaperMetadata(firstPage.text) : {}
        const title    = meta.title   || path.basename(filePath, '.pdf')
        const authors  = meta.authors || ''
        const abstract = meta.abstract || ''

        let affiliationsJson = null
        if (firstPage.success) {
          const aiAffil = await llm.extractAffiliationsWithAI(firstPage.text)
          if (aiAffil && aiAffil.length > 0) {
            affiliationsJson = JSON.stringify(aiAffil.map(a => ({ name: '', affiliations: [a] })))
          }
        }

        const paperId = 'ref-' + path.basename(filePath, '.pdf').replace(/[^a-zA-Z0-9._-]/g, '-')
        if (!db.getPaper(paperId)) {
          db.savePaper({
            id:             paperId,
            title,
            authors,
            abstract,
            pdf_url:        filePath,
            published_date: '',
            affiliations:   affiliationsJson,
            pdf_text:       extracted.success ? extracted.text : null,
            summary:        null,
            quiz:           null,
            notes:          null,
            pdf_error:      extracted.success ? null : extracted.error,
            status:         extracted.success ? 'ready' : 'pdf_error'
          })
        }

        if (!db.getReferencePaper(filePath)) {
          const embedding = await embProvider.generateEmbedding(snippet)
          const abstractSummary = await llm.summarizeAbstract(abstract || snippet)
          db.saveReferencePaper({ path: filePath, snippet, embedding: JSON.stringify(embedding), abstract_summary: abstractSummary })
        }

        indexed++
      } catch (err) {
        console.error(`[index-files] ${path.basename(filePath)}: ${err.message}`)
        errors++
      }
    }

    return { indexed, errors, total: db.getReferenceCount() }
  })

  ipcMain.handle('get-reference-list', () =>
    db.getReferencePapersList().map(r => {
      const filename = path.basename(r.path, '.pdf')
      const paperId  = 'ref-' + filename.replace(/[^a-zA-Z0-9._-]/g, '-')
      const paper    = db.getPaper(paperId)
      const name     = paper?.title || filename
      return { id: r.id, path: r.path, name, paperId }
    })
  )

  ipcMain.handle('delete-reference', (_e, { filePath, paperId }) => {
    db.deleteReferencePaper(filePath)
    db.deletePaper(paperId)
    return { success: true }
  })

  ipcMain.handle('rename-reference', (_e, { paperId, newTitle }) => {
    db.updatePaperTitle(paperId, newTitle)
    return { success: true }
  })
}

module.exports = { registerReferenceHandlers }