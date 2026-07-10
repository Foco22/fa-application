const fs   = require('fs')
const path = require('path')
const os   = require('os')

const DEFAULT_VAULT_DIR = path.join(os.homedir(), 'Documents', 'PaperLearning', 'vault')

function isoWeek(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
  const week1 = new Date(d.getFullYear(), 0, 4)
  return 1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7)
}

function paperSlot(paper) {
  const d = new Date(paper.published_date || paper.created_at || Date.now())
  const week = isoWeek(d)
  return {
    year:    String(d.getFullYear()),
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

// Nombre de carpeta para un paper de referencia: el título legible del paper,
// con fallback al id (ref-…) si todavía no tiene título.
function referenceFolderName(paper) {
  const title = paper && paper.title && paper.title.trim()
  return title ? sanitizeFolderName(title) : (paper && paper.id) || 'untitled'
}

function paperDir(vaultDir, paper) {
  if (isReferencePaper(paper)) {
    return path.join(vaultDir, 'reference', referenceFolderName(paper))
  }
  const { year, weekKey } = paperSlot(paper)
  return path.join(vaultDir, year, weekKey, paper.id)
}

function ensureDirs(vaultDir, paper) {
  const dir = paperDir(vaultDir, paper)
  fs.mkdirSync(path.join(dir, 'raw'),    { recursive: true })
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'slides'), { recursive: true })
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

// Migración: lleva los papers de referencia (ref-…) a la carpeta reference/
// dedicada y los renombra al título legible del paper. `resolveName(dirName)`
// mapea el nombre de carpeta actual (ej. "ref-1706.03762v7") al nombre destino
// (ej. "Attention Is All You Need"); por defecto conserva el nombre. Cubre dos
// casos: ref-… sueltos en <año>/<semana>/ y ref-… ya dentro de reference/.
// Idempotente: no toca carpetas que ya están en su destino.
function migrateReferencePapers(vaultDir, resolveName = (n) => n) {
  const moved = []
  if (!fs.existsSync(vaultDir)) return { moved: 0, dirs: moved }

  const referenceRoot = path.join(vaultDir, 'reference')

  // Sube por los directorios padres borrando los que hayan quedado vacíos tras
  // mover un paper (la semana, y luego el año), sin pasar de vaultDir.
  const pruneEmptyParents = (startDir) => {
    let dir = startDir
    while (dir !== vaultDir && dir.startsWith(vaultDir + path.sep)) {
      try {
        if (fs.readdirSync(dir).length > 0) break
        fs.rmdirSync(dir)
      } catch { break }
      dir = path.dirname(dir)
    }
  }

  const relocate = (currentPath, dirName) => {
    const targetName = sanitizeFolderName(resolveName(dirName) || dirName)
    const dest = path.join(referenceRoot, targetName)
    if (currentPath === dest) return          // ya está en su destino
    if (fs.existsSync(dest)) return           // no pisar una carpeta existente
    fs.mkdirSync(referenceRoot, { recursive: true })
    fs.renameSync(currentPath, dest)
    moved.push(dest)
    pruneEmptyParents(path.dirname(currentPath))
  }

  // 1) ref-… que viven fuera de reference/ (típicamente en <año>/<semana>/)
  const walk = (dir) => {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const full = path.join(dir, e.name)
      if (full === referenceRoot) continue     // reference/ se maneja aparte (paso 2)
      if (e.name.startsWith('ref-')) { relocate(full, e.name); continue }
      if (e.name !== 'fetch-logs') walk(full)
    }
  }
  walk(vaultDir)

  // 2) ref-… que ya están dentro de reference/ pero con el id como nombre →
  //    renombrarlos al título.
  try {
    for (const e of fs.readdirSync(referenceRoot, { withFileTypes: true })) {
      if (e.isDirectory() && e.name.startsWith('ref-')) {
        relocate(path.join(referenceRoot, e.name), e.name)
      }
    }
  } catch { /* reference/ no existe todavía */ }

  return { moved: moved.length, dirs: moved }
}

function deletePaperDir(vaultDir, paper) {
  const dir = paperDir(vaultDir, paper)
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
}

module.exports = {
  DEFAULT_VAULT_DIR,
  isoWeek, paperSlot, paperDir,
  isReferencePaper, sanitizeFolderName, referenceFolderName,
  ensureDirs, pdfPath, writeSummary, writeQuiz, slidesDir, writeSlide,
  backfillSlideDirs, migrateReferencePapers, deletePaperDir
}
