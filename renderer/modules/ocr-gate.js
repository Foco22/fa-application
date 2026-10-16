// Regla de producto: resumen, quiz, clase y chat con un paper exigen OCR previo.
// Espejo de src/ingestion/ocr-gate.js para avisar al usuario sin esperar al proceso
// principal (que vuelve a imponer la regla). Sin paper activo no hay nada que exigir.
export function needsOcr(paper) {
  return Boolean(paper) && paper.pdf_text_source !== 'ocr'
}
