const { app, BrowserWindow, ipcMain, Notification, shell, dialog } = require('electron')

// Web Speech API on Linux requires speech-dispatcher
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-speech-dispatcher')
}
const path = require('path')
const fs = require('fs')
const axios = require('axios')
const pdfParse = require('pdf-parse')

const { openDatabase }        = require('./src/database')
const { fetchPapers, getAffiliations, matchesUniversityList, downloadPdf, extractText, extractFirstPage, matchesUniversityInText } = require('./src/ingestion')
const { createLLM } = require('./src/llm')
const { chatWithPaper }               = require('./src/chat')
const { createScheduler }     = require('./src/scheduler')
const cron                    = require('node-cron')
const { registerHandlers }    = require('./src/ipc')
const { createEmbeddings, hasEmbeddingConfig, indexReferenceFolder, indexFiles, scoreEmbeddingAgainst, embedKeywordList } = require('./src/embeddings')
const { extractKeywords, keywordOverlap } = require('./src/ingestion/keywords')
const { createReranker } = require('./src/rerank')
const { createTranscription } = require('./src/transcription')
const { createWhisperStream } = require('./src/transcription/whisper-stream')
const vaultMod                = require('./src/vault')
const fetchLogMod             = require('./src/ingestion/fetchLog')

const DB_PATH             = path.join(app.getPath('userData'), 'papers.db')
const PDFS_DIR            = path.join(app.getPath('userData'), 'pdfs')
const VAULT_DIR           = vaultMod.DEFAULT_VAULT_DIR
const WHISPER_STREAM_BIN  = path.join(__dirname, 'tools/whisper.cpp/build/bin/whisper-stream')
const WHISPER_MODELS_DIR  = path.join(__dirname, 'tools/whisper.cpp/models')

let mainWindow
let db
let scheduler

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })
  mainWindow.maximize()
  mainWindow.loadFile('renderer/index.html')

  // El renderer aplica y persiste su propio zoom (webFrame). Aquí solo
  // desactivamos el pinch-zoom para que no se descontrole por accidente.
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.setVisualZoomLevelLimits(1, 1)
  })

  ipcMain.on('renderer-log', (_e, msg) => console.log('[renderer]', msg))
  ipcMain.on('window-minimize', () => mainWindow.minimize())
  ipcMain.on('window-maximize', () => {
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
  })
  ipcMain.on('window-close', () => mainWindow.close())
}

app.whenReady().then(() => {
  if (!fs.existsSync(PDFS_DIR)) fs.mkdirSync(PDFS_DIR, { recursive: true })
  fs.mkdirSync(VAULT_DIR, { recursive: true })

  db = openDatabase(DB_PATH)

  // Layout del vault: mover/renombrar cada carpeta de paper a su ubicación
  // canónica (nombrada por título; los ref-… van a reference/), y garantizar
  // que todo paper de la DB tenga su carpeta aunque aún no tenga contenido.
  const allPapers  = db.getPapers()
  const folderMig  = vaultMod.migratePaperFolders(VAULT_DIR, allPapers)
  if (folderMig.moved > 0) {
    console.log(`[startup] vault: ${folderMig.moved} carpeta(s) movida(s)/renombrada(s)`)
  }
  for (const p of allPapers) vaultMod.ensureDirs(VAULT_DIR, p)

  // raw/ debe tener siempre el PDF. Los papers de referencia tienen su PDF en
  // una ruta local (pdf_url) que no se copió al vault — copiarlo ahora si falta.
  for (const p of allPapers) {
    if (p.pdf_url && !/^https?:/i.test(p.pdf_url) && fs.existsSync(p.pdf_url)
        && !fs.existsSync(vaultMod.pdfPath(VAULT_DIR, p))) {
      try { vaultMod.copyPdfToRaw(VAULT_DIR, p, p.pdf_url) }
      catch (err) { console.error(`[startup] no se pudo copiar PDF de ${p.id} al vault: ${err.message}`) }
    }
  }

  // Backfill: cualquier carpeta de paper que aún no tenga slides/ (ej. huérfanas
  // sin fila en la DB) la recibe ahora.
  const slidesBackfill = vaultMod.backfillSlideDirs(VAULT_DIR)
  if (slidesBackfill.created > 0) {
    console.log(`[startup] slides/ backfill: ${slidesBackfill.created} carpeta(s) creada(s)`)
  }

  createWindow()

  const vault = {
    dir:          VAULT_DIR,
    ensureDirs:   (paper)       => vaultMod.ensureDirs(VAULT_DIR, paper),
    pdfPath:      (paper)       => vaultMod.pdfPath(VAULT_DIR, paper),
    writeSummary:    (paper, text) => vaultMod.writeSummary(VAULT_DIR, paper, text),
    writeQuiz:       (paper, quiz) => vaultMod.writeQuiz(VAULT_DIR, paper, quiz),
    copyPdfToRaw: (paper, src)     => vaultMod.copyPdfToRaw(VAULT_DIR, paper, src),
    slidesDir:       (paper)       => vaultMod.slidesDir(VAULT_DIR, paper),
    writeSlide:   (paper, filename, buf) => vaultMod.writeSlide(VAULT_DIR, paper, filename, buf),
    deletePaperDir:  (paper)       => vaultMod.deletePaperDir(VAULT_DIR, paper),
  }

  const settings = db.getAllSettings()
  const { runFetch } = registerHandlers({
    ipcMain, db, mainWindow,
    deps: {
      createLLM,
      chatWithPaper, fetchPapers,
      getAffiliations, matchesUniversityList,
      downloadPdf, extractText, extractFirstPage, matchesUniversityInText,
      createEmbeddings, hasEmbeddingConfig, scoreEmbeddingAgainst, embedKeywordList, indexReferenceFolder, indexFiles,
      extractKeywords, keywordOverlap, createReranker,
      createTranscription,
      createWhisperStream,
      getAppVersion: () => app.getVersion(),
      whisperStreamBin:  fs.existsSync(WHISPER_STREAM_BIN) ? WHISPER_STREAM_BIN : null,
      whisperModelsDir:  fs.existsSync(WHISPER_MODELS_DIR) ? WHISPER_MODELS_DIR : null,
      shell, dialog,
      httpClient: axios, pdfParse, pdfsDir: PDFS_DIR, vault,
      writeFetchLog: (report) => fetchLogMod.writeFetchLog(VAULT_DIR, report)
    }
  })

  // Auto-index reference folder on startup
  if (settings.referenceFolderPath && hasEmbeddingConfig(settings)) {
    const embeddingProvider = createEmbeddings(settings)
    const llm = settings.apiKey ? createLLM(settings) : null
    indexReferenceFolder(settings.referenceFolderPath, db, embeddingProvider, pdfParse, llm)
      .then(r => console.log(`[startup] Reference index: +${r.indexed} indexed, ${r.errors} errors`))
      .catch(err => console.error('[startup] Reference index error:', err.message))
  }

  scheduler = createScheduler(settings, async () => {
    const result = await runFetch()
    if (Array.isArray(result) && result.length > 0) {
      new Notification({
        title: 'Paper Learning',
        body: `${result.length} paper${result.length > 1 ? 's' : ''} nuevo${result.length > 1 ? 's' : ''} listo${result.length > 1 ? 's' : ''}`
      }).show()
    }
  }, cron)
})

app.on('window-all-closed', () => {
  scheduler?.stop()
  db?.close()
  if (process.platform !== 'darwin') app.quit()
})