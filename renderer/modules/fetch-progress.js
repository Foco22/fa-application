// Barra de progreso del Fetch: cada etapa del pipeline ocupa un tramo de una
// única barra 0–100% que solo avanza. Los tramos son una estimación de cuánto
// tarda cada etapa (la descarga de ArXiv y los embeddings dominan).
export const FETCH_STAGES = {
  arxiv:     { from: 0,  to: 40,  key: 'fetch-etapa-arxiv' },
  embedding: { from: 40, to: 70,  key: 'fetch-etapa-embedding' },
  rerank:    { from: 70, to: 90,  key: 'fetch-etapa-rerank' },
  saving:    { from: 90, to: 100, key: 'fetch-etapa-saving' },
}

// ev: { stage, current, total } tal como lo emite main por 'fetch-progress'.
// Devuelve { percent, label } o null si la etapa no se conoce.
export function fetchProgressView(ev, t) {
  const stage = FETCH_STAGES[ev.stage]
  if (!stage) return null

  const hasTotal = Number.isFinite(ev.total) && ev.total > 0
  const fraction = hasTotal ? Math.min(1, Math.max(0, ev.current / ev.total)) : 0
  const percent  = Math.round(stage.from + fraction * (stage.to - stage.from))

  const name  = t(stage.key)
  const label = hasTotal ? `${name} · ${ev.current} / ${ev.total}` : name
  return { percent, label }
}
