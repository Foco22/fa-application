const { STUDENTS, generateTurn, evaluateAndReact, evaluateClarity } = require('./students')
const { generateHint, assistantChat } = require('./hints')

function canHaveClass(paper) {
  if (!paper) return { ok: false, reason: 'No hay paper seleccionado.' }
  if (paper.status === 'downloading') return { ok: false, reason: 'El paper todavía se está descargando.' }
  if (!paper.pdf_text && !paper.abstract) return { ok: false, reason: 'El paper no tiene texto disponible.' }
  if (!paper.pdf_text && paper.abstract) return { ok: true, warning: 'Solo hay abstract disponible — los agentes tendrán contexto limitado.' }
  return { ok: true }
}

module.exports = { STUDENTS, generateTurn, evaluateAndReact, evaluateClarity, canHaveClass, generateHint, assistantChat }
