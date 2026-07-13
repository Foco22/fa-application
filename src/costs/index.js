const { getPriceFor } = require('../pricing')

const MICRO_PER_USD = 1_000_000

// Proveedores que corren en la máquina del usuario: gratis, pero se registran
// igual con costo 0 para que el dashboard los muestre como "Local — $0" en vez
// de que desaparezcan del desglose.
const FREE_PROVIDERS = ['local']

// null = "no se puede saber el costo", que NO es lo mismo que 0. El dashboard
// los reporta aparte como costo desconocido para no subestimar el gasto.
function computeCostMicroUsd(event, price) {
  if (!price) return null

  const { prompt_tokens, completion_tokens, audio_seconds } = event

  if (audio_seconds != null && price.audio_price_per_second != null) {
    return Math.round(audio_seconds * price.audio_price_per_second * MICRO_PER_USD)
  }

  if (prompt_tokens != null || completion_tokens != null) {
    const usd = (prompt_tokens || 0) * (price.prompt_price_per_token || 0)
              + (completion_tokens || 0) * (price.completion_price_per_token || 0)
    return Math.round(usd * MICRO_PER_USD)
  }

  // El proveedor no reportó uso: se registra el evento, pero sin costo inventado.
  return null
}

// Se llama desde dentro de cada método de proveedor, como último paso antes de
// retornar. Nunca lanza: un fallo del tracking de costos no puede tumbar el
// resumen/quiz/chat que el usuario pidió.
function recordUsage(db, event) {
  try {
    const isFree = FREE_PROVIDERS.includes(event.provider)
    const price  = isFree ? null : getPriceFor(db, event.provider, event.model)

    const cost = isFree ? 0 : computeCostMicroUsd(event, price)

    db.saveUsageEvent({
      ...event,
      // El precio usado queda congelado en la fila: si el proveedor cambia la
      // tarifa mañana, el historial de gasto no se reescribe retroactivamente.
      prompt_price_per_token:     price?.prompt_price_per_token ?? null,
      completion_price_per_token: price?.completion_price_per_token ?? null,
      cost_micro_usd:             cost,
    })
  } catch (err) {
    console.error(`[costs] no se pudo registrar el uso: ${err.message}`)
  }
}

function makeUsageRecorder(db) {
  return (event) => recordUsage(db, event)
}

module.exports = { recordUsage, makeUsageRecorder, computeCostMicroUsd, MICRO_PER_USD }
