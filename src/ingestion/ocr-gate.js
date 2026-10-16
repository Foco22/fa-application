// Regla de producto: resumen, quiz, clase y chat con un paper solo corren sobre el
// texto del OCR. El texto básico de pdf-parse (recortado a ~30K, sin tablas ni
// fórmulas) no basta. Esta función es la única fuente de verdad de esa regla.
const OCR_REQUIRED = 'ocr-required'

function hasOcr(paper) {
  return paper?.pdf_text_source === 'ocr'
}

module.exports = { hasOcr, OCR_REQUIRED }
