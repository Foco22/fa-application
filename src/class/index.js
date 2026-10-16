const { STUDENTS, generateTurn, evaluateAndReact, evaluateClarity, evaluatePresentation, generateReferenceAnswer } = require('./students')
const { generateHint, assistantChat } = require('./hints')
const { hasOcr, OCR_REQUIRED } = require('../ingestion/ocr-gate')

function canHaveClass(paper) {
  if (!paper) return { ok: false, reason: 'No hay paper seleccionado.' }
  if (paper.status === 'downloading') return { ok: false, reason: 'El paper todavía se está descargando.' }
  // Los agentes corrigen al profesor contra el texto del paper: tiene que ser el del OCR.
  if (!hasOcr(paper)) return { ok: false, code: OCR_REQUIRED, reason: 'Primero haz el OCR de este paper (botón OCR). La clase se apoya en el texto completo.' }
  if (!paper.pdf_text && !paper.abstract) return { ok: false, reason: 'El paper no tiene texto disponible.' }
  if (!paper.pdf_text && paper.abstract) return { ok: true, warning: 'Solo hay abstract disponible — los agentes tendrán contexto limitado.' }
  return { ok: true }
}

module.exports = { STUDENTS, generateTurn, evaluateAndReact, evaluateClarity, evaluatePresentation, generateReferenceAnswer, canHaveClass, generateHint, assistantChat }
