// Pregunta previa al Fetch: maxPapers es un tope SEMANAL, así que si ya hay papers
// de esta semana se pregunta si se reemplazan antes de buscar de nuevo.
//
// status: { count, max, papers: [{ id, title, hasUserData }] } (IPC 'get-week-status').
// Devuelve null si no hay nada que preguntar.
export function fetchWeekPromptView(status, t) {
  if (!status || status.count === 0) return null

  const missing = Math.max(0, status.max - status.count)
  return {
    title: t('fetch-semana-titulo'),
    body: `${status.count}/${status.max} ${t('fetch-semana-cuerpo')}`,
    items: status.papers.map(p => ({ title: p.title, hasUserData: p.hasUserData })),
    // Reemplazar borra el paper: avisar si se pierde un resumen, quiz o notas.
    warnDataLoss: status.papers.some(p => p.hasUserData),
    // Con la semana incompleta (p. ej. falló una descarga) se puede completar sin borrar.
    canComplete: missing > 0,
    missing,
  }
}
