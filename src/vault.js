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

function paperDir(vaultDir, paper) {
  const { year, weekKey } = paperSlot(paper)
  return path.join(vaultDir, year, weekKey, paper.id)
}

function ensureDirs(vaultDir, paper) {
  const dir = paperDir(vaultDir, paper)
  fs.mkdirSync(path.join(dir, 'raw'),    { recursive: true })
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true })
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

function deletePaperDir(vaultDir, paper) {
  const dir = paperDir(vaultDir, paper)
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
}

module.exports = {
  DEFAULT_VAULT_DIR,
  isoWeek, paperSlot, paperDir,
  ensureDirs, pdfPath, writeSummary, writeQuiz, deletePaperDir
}
