const fs   = require('fs')
const path = require('path')
const os   = require('os')

const DEFAULT_VAULT_DIR = path.join(os.homedir(), 'Documents', 'Ra', 'vault')

// TODO el cálculo va en UTC, a propósito.
//
// JS parsea una fecha sin hora ('2025-06-16') como medianoche UTC, pero los
// getters locales (getDay/getDate) la leían en la zona del usuario: en Chile
// (UTC−4) eso es el día ANTERIOR a las 20:00, así que el paper se archivaba en
// la semana equivocada del vault. Es un bug que solo aparecía fuera de UTC —
// por eso el CI, que corre en UTC, nunca lo vio.
//
// Se usan getters UTC en vez de convertir a local porque las dos fuentes de
// fecha ya son UTC: `published_date` de ArXiv viene sin hora, y `created_at` lo
// escribe SQLite con datetime('now'), que es UTC. Así la carpeta de un paper es
// la misma sin importar desde qué zona se abra la app.
function isoWeek(date) {
  const d = new Date(date)
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7))
  const week1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  return 1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getUTCDay() + 6) % 7)) / 7)
}

function paperSlot(paper) {
  const d = new Date(paper.published_date || paper.created_at || Date.now())
  const week = isoWeek(d)
  return {
    // getUTCFullYear por lo mismo que isoWeek: el 1 de enero a las 00:00 UTC no
    // puede caer en el año anterior sólo porque el usuario esté en Chile.
    year:    String(d.getUTCFullYear()),
    weekKey: `week-${String(week).padStart(2, '0')}`
  }
}

// Los papers de referencia (id "ref-…") no pertenecen a una semana de ingesta:
// viven en su propia carpeta reference/ en la raíz del vault.
function isReferencePaper(paper) {
  return typeof (paper && paper.id) === 'string' && paper.id.startsWith('ref-')
}

// Limpia un título para usarlo como nombre de carpeta: quita caracteres
// inválidos en Windows (< > : " / \ | ? * y control), colapsa espacios, y
// recorta puntos/espacios finales. Trunca para no exceder límites de ruta.
function sanitizeFolderName(name) {
  const cleaned = String(name || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 100)
    .trim()
  return cleaned || 'untitled'
}

// Nombre de carpeta de un paper: su título legible, con fallback al id si aún
// no tiene título. Se usa tanto para papers de ingesta como de referencia.
function paperFolderName(paper) {
  const title = paper && paper.title && paper.title.trim()
  return title ? sanitizeFolderName(title) : (paper && paper.id) || 'untitled'
}
// Alias histórico.
const referenceFolderName = paperFolderName

function paperDir(vaultDir, paper) {
  const name = paperFolderName(paper)
  if (isReferencePaper(paper)) {
    return path.join(vaultDir, 'reference', name)
  }
  const { year, weekKey } = paperSlot(paper)
  return path.join(vaultDir, year, weekKey, name)
}

function ensureDirs(vaultDir, paper) {
  const dir = paperDir(vaultDir, paper)
  fs.mkdirSync(path.join(dir, 'raw'),    { recursive: true })
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'slides'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'ocr'),    { recursive: true })
  return dir
}

function pdfPath(vaultDir, paper) {
  return path.join(paperDir(vaultDir, paper), 'raw', `${paper.id}.pdf`)
}

function writeSummary(vaultDir, paper, text) {
  const dir = path.join(paperDir(vaultDir, paper), 'assets')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'summary.md'), text, 'utf8')
}

function writeQuiz(vaultDir, paper, quiz) {
  const dir = path.join(paperDir(vaultDir, paper), 'assets')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'quiz.json'), JSON.stringify(quiz, null, 2), 'utf8')
}

// OCR fiel del PDF, un Markdown legible/editable por el usuario en ocr/<id>.md,
// junto a raw/, assets/ y slides/. Sigue el patrón de writeSummary/writeQuiz.
function ocrPath(vaultDir, paper) {
  return path.join(paperDir(vaultDir, paper), 'ocr', `${paper.id}.md`)
}

function writeOcr(vaultDir, paper, markdown) {
  const dest = ocrPath(vaultDir, paper)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, markdown, 'utf8')
  return dest
}

// Lee el Markdown de OCR desde disco (fuente "legible por humanos"). Devuelve
// null si el archivo no existe. Lo usa "Recargar desde archivo" para resincronizar
// papers.pdf_text con lo que el usuario editó a mano, sin llamar al LLM.
function readOcr(vaultDir, paper) {
  const src = ocrPath(vaultDir, paper)
  if (!fs.existsSync(src)) return null
  return fs.readFileSync(src, 'utf8')
}

// Copia un PDF de origen (ej. la carpeta Downloads del usuario) a raw/<id>.pdf
// del paper, para que el vault sea autocontenido y raw/ siempre tenga el PDF.
function copyPdfToRaw(vaultDir, paper, srcPath) {
  const dest = pdfPath(vaultDir, paper)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(srcPath, dest)
  return dest
}

function slidesDir(vaultDir, paper) {
  return path.join(paperDir(vaultDir, paper), 'slides')
}

// Persiste una slide (imagen) en la carpeta slides/ del paper, junto al PDF
// (raw/) y los assets generados (assets/). Devuelve la ruta escrita.
function writeSlide(vaultDir, paper, filename, buffer) {
  const dir = slidesDir(vaultDir, paper)
  fs.mkdirSync(dir, { recursive: true })
  const dest = path.join(dir, filename)
  fs.writeFileSync(dest, buffer)
  return dest
}

// Backfill para papers ya existentes en el vault: recorre el árbol y crea la
// carpeta slides/ en cada directorio de paper que no la tenga. Un "paper dir"
// se reconoce por tener un subdirectorio raw/ o assets/ — así cubre tanto los
// papers de ingesta como los de referencia, e ignora fetch-logs/ y demás.
function backfillSlideDirs(vaultDir) {
  const created = []
  if (!fs.existsSync(vaultDir)) return { created: 0, dirs: created }

  const isPaperDir = (dir) =>
    fs.existsSync(path.join(dir, 'raw')) || fs.existsSync(path.join(dir, 'assets'))

  const walk = (dir) => {
    if (isPaperDir(dir)) {
      const slides = path.join(dir, 'slides')
      if (!fs.existsSync(slides)) {
        fs.mkdirSync(slides, { recursive: true })
        created.push(slides)
      }
      return // no descender dentro de raw/assets/slides
    }
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.isDirectory() && e.name !== 'fetch-logs') walk(path.join(dir, e.name))
    }
  }

  walk(vaultDir)
  return { created: created.length, dirs: created }
}

// Sube por los directorios padres borrando los que hayan quedado vacíos tras
// mover una carpeta (la semana, luego el año), sin pasar de vaultDir.
function pruneEmptyParents(vaultDir, startDir) {
  let dir = startDir
  while (dir !== vaultDir && dir.startsWith(vaultDir + path.sep)) {
    try {
      if (fs.readdirSync(dir).length > 0) break
      fs.rmdirSync(dir)
    } catch { break }
    dir = path.dirname(dir)
  }
}

// Indexa todas las carpetas de paper existentes (las que tienen raw/ o assets/)
// por su basename, para poder localizar la carpeta vieja de un paper aunque esté
// nombrada por id o esté en otra semana. Ignora fetch-logs/.
function indexPaperDirs(vaultDir) {
  const index = new Map()
  const walk = (dir) => {
    if (fs.existsSync(path.join(dir, 'raw')) || fs.existsSync(path.join(dir, 'assets'))) {
      index.set(path.basename(dir), dir)
      return // no descender dentro de un paper dir
    }
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.isDirectory() && e.name !== 'fetch-logs') walk(path.join(dir, e.name))
    }
  }
  walk(vaultDir)
  return index
}

// Migración DB-driven: para cada paper conocido, mueve/renombra su carpeta a la
// ubicación canónica que dicta paperDir (ahora nombrada por título). Cubre en un
// solo paso: renombrar carpetas de ingesta id→título, y mover papers de
// referencia (ref-…) desde <año>/<semana>/ o reference/<id> hacia
// reference/<título>. Idempotente: no toca las que ya están en su destino, ni
// las carpetas huérfanas (sin fila en la DB). Limpia semanas/años que queden
// vacíos tras un movimiento.
function migratePaperFolders(vaultDir, papers) {
  const moved = []
  if (!fs.existsSync(vaultDir)) return { moved: 0, dirs: moved }

  const index = indexPaperDirs(vaultDir)

  for (const paper of papers) {
    // Se busca por id (carpetas viejas, nombradas por id) y también por el nombre
    // canónico: el bug de zona horaria dejó carpetas BIEN nombradas pero en la
    // semana equivocada, y buscándolas solo por id se quedaban ahí para siempre.
    const src = index.get(paper.id) || index.get(paperFolderName(paper))
    if (!src) continue
    const target = paperDir(vaultDir, paper)
    if (src === target || fs.existsSync(target)) continue
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.renameSync(src, target)
    moved.push(target)
    pruneEmptyParents(vaultDir, path.dirname(src))
  }

  return { moved: moved.length, dirs: moved }
}

function deletePaperDir(vaultDir, paper) {
  const dir = paperDir(vaultDir, paper)
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
}

module.exports = {
  DEFAULT_VAULT_DIR,
  isoWeek, paperSlot, paperDir,
  isReferencePaper, sanitizeFolderName, paperFolderName, referenceFolderName,
  ensureDirs, pdfPath, copyPdfToRaw, writeSummary, writeQuiz, slidesDir, writeSlide,
  ocrPath, writeOcr, readOcr,
  backfillSlideDirs, migratePaperFolders, deletePaperDir
}
