// Regla de producto: maxPapers es un tope SEMANAL, no por ejecución. Ejecutar el
// fetch varias veces en la misma semana iba acumulando papers.

// SQLite guarda created_at como datetime('now'): UTC, 'YYYY-MM-DD HH:MM:SS'.
function toSqliteUtc(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

// Lunes 00:00 de la semana en curso en hora LOCAL, expresado en UTC con el mismo
// formato que created_at para poder comparar como string. Agrupar por fecha UTC
// movía papers de domingo noche a la semana siguiente (bug de zona horaria).
function weekStartUtc(now = new Date()) {
  const start = new Date(now)
  start.setDate(now.getDate() - ((now.getDay() + 6) % 7))
  start.setHours(0, 0, 0, 0)
  return toSqliteUtc(start)
}

// Papers traídos por el fetch esta semana. Los 'ref-*' son referencias indexadas
// por el usuario (también viven en la tabla papers): no cuentan ni se borran.
function papersOfThisWeek(papers, now = new Date()) {
  const start = weekStartUtc(now)
  return papers.filter(p => !String(p.id).startsWith('ref-') && p.created_at >= start)
}

// Contenido que el usuario perdería al borrar el paper (o que costó tokens generar).
const USER_DATA_FIELDS = ['summary', 'quiz', 'notes', 'highlights', 'slides_md']

function hasUserData(paper) {
  return USER_DATA_FIELDS.some(field => {
    const value = paper[field]
    return typeof value === 'string' ? value.trim() !== '' : Boolean(value)
  })
}

module.exports = { weekStartUtc, papersOfThisWeek, hasUserData }
