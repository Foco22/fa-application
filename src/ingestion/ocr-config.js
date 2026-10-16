// Resuelve, a partir de los settings, CÓMO se hace el OCR de un paper. Es la única
// fuente de verdad que lee el handler `generate-ocr`.
//
//   ocrEngine       'llamaparse' | 'vision'   (pestaña OCR de Configuración)
//   llamaParseApiKey / llamaParseTier          (solo motor LlamaParse)
//   ocrModel                                   (solo motor visión; vacío = el del LLM)

// `fast` queda fuera a propósito: no devuelve markdown, así que el OCR fallaría en silencio.
const LLAMAPARSE_TIERS = ['cost_effective', 'agentic', 'agentic_plus']
const DEFAULT_TIER     = 'cost_effective'

function resolveOcrConfig(settings) {
  const apiKey = (settings.llamaParseApiKey || '').trim()

  // Quien ya había pegado su key antes de existir la pestaña OCR conserva LlamaParse.
  const engine = settings.ocrEngine === 'llamaparse' || settings.ocrEngine === 'vision'
    ? settings.ocrEngine
    : (apiKey ? 'llamaparse' : 'vision')

  const tier = LLAMAPARSE_TIERS.includes(settings.llamaParseTier) ? settings.llamaParseTier : DEFAULT_TIER

  // El OCR de visión usa el proveedor y la key del LLM; solo puede cambiar el modelo.
  const ocrModel = (settings.ocrModel || '').trim()
  const visionSettings = ocrModel ? { ...settings, llmModel: ocrModel } : { ...settings }

  return { engine, llamaParse: { apiKey, tier }, visionSettings }
}

module.exports = { resolveOcrConfig, LLAMAPARSE_TIERS, DEFAULT_TIER }
