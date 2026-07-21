const Database = require('better-sqlite3')

// Modelo con el que se indexó todo antes de que existiera la columna
// `embedding_model`: las filas viejas, sin sello, sólo pueden venir de aquí.
const LEGACY_EMBEDDING_MODEL = 'openai:text-embedding-3-small'

// Same "days since Monday" idiom as src/ingestion/arxiv.js / src/vault.js: 0=Sun..6=Sat.
function isoDate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function mondayOf(date) {
  const d = new Date(date)
  const daysBack = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - daysBack)
  return isoDate(d)
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00`)
  d.setDate(d.getDate() + days)
  return isoDate(d)
}

function openDatabase(path) {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS class_sessions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      paper_id      TEXT NOT NULL REFERENCES papers(id),
      duration      INTEGER NOT NULL,
      transcript    TEXT,
      clarity_score INTEGER,
      feedback      TEXT,
      qa_summary    TEXT,
      created_at    DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS class_slides (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id     INTEGER NOT NULL REFERENCES class_sessions(id),
      order_index    INTEGER NOT NULL,
      image_data     TEXT NOT NULL,
      mime_type      TEXT NOT NULL DEFAULT 'image/jpeg',
      interpretation TEXT,
      label          TEXT
    );

    CREATE TABLE IF NOT EXISTS papers (
      id             TEXT PRIMARY KEY,
      title          TEXT NOT NULL,
      authors        TEXT,
      abstract       TEXT,
      pdf_url        TEXT,
      published_date TEXT,
      affiliations   TEXT,
      pdf_text       TEXT,
      summary        TEXT,
      quiz           TEXT,
      notes          TEXT,
      pdf_error      TEXT,
      status         TEXT NOT NULL DEFAULT 'new',
      created_at     DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS quiz_results (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      paper_id   TEXT NOT NULL REFERENCES papers(id),
      score      INTEGER NOT NULL,
      total      INTEGER NOT NULL,
      answers    TEXT,
      taken_at   DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS reference_papers (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      path              TEXT UNIQUE NOT NULL,
      snippet           TEXT,
      embedding         TEXT NOT NULL,
      abstract_summary  TEXT,
      embedding_model   TEXT,
      indexed_at        DATETIME DEFAULT (datetime('now'))
    );

    -- Un evento por cada llamada pagada a IA. Los montos van como ENTEROS en
    -- micro-USD (1 USD = 1.000.000): sumar miles de eventos en REAL acumularía
    -- drift de punto flotante y el total no cerraría con la factura real. La UI
    -- divide por 1e6 recién al mostrar, después de sumar los enteros.
    -- cost_micro_usd NULL = precio desconocido (modelo sin tarifa conocida);
    -- no es lo mismo que 0 y no debe sumarse silenciosamente como gratis.
    CREATE TABLE IF NOT EXISTS usage_events (
      id                          INTEGER PRIMARY KEY AUTOINCREMENT,
      occurred_at                 DATETIME DEFAULT (datetime('now')),
      action_type                 TEXT NOT NULL,
      provider                    TEXT NOT NULL,
      model                       TEXT,
      prompt_tokens               INTEGER,
      completion_tokens           INTEGER,
      audio_seconds               REAL,
      units                       REAL,
      prompt_price_per_token      REAL,
      completion_price_per_token  REAL,
      cost_micro_usd              INTEGER,
      paper_id                    TEXT,
      session_id                  INTEGER,
      created_at                  DATETIME DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_usage_occurred  ON usage_events (occurred_at);
    CREATE INDEX IF NOT EXISTS idx_usage_provider  ON usage_events (provider);

    -- Precios por unidad. Se quedan como REAL a propósito: no se suman entre sí,
    -- se usan una sola vez por evento para calcular cost_micro_usd, así que no
    -- están expuestos al drift que sí afectaría a los montos acumulados.
    CREATE TABLE IF NOT EXISTS pricing_cache (
      provider                    TEXT NOT NULL,
      model                       TEXT NOT NULL,
      prompt_price_per_token      REAL,
      completion_price_per_token  REAL,
      audio_price_per_second      REAL,
      unit                        TEXT,
      source                      TEXT NOT NULL DEFAULT 'litellm',
      fetched_at                  DATETIME DEFAULT (datetime('now')),
      PRIMARY KEY (provider, model)
    );
  `)

  // Migrate: add columns if they don't exist yet (existing DBs)
  try { db.exec('ALTER TABLE papers ADD COLUMN notes TEXT') } catch (_) {}
  try { db.exec('ALTER TABLE papers ADD COLUMN highlights TEXT') } catch (_) {}
  // pdf_text_source: 'ocr' | 'pdf-parse' | null (papers previos a la feature).
  // ocr_error: detalle si la corrida de OCR falló completamente (análogo a pdf_error).
  try { db.exec('ALTER TABLE papers ADD COLUMN pdf_text_source TEXT') } catch (_) {}
  try { db.exec('ALTER TABLE papers ADD COLUMN ocr_error TEXT') } catch (_) {}
  try { db.exec('ALTER TABLE reference_papers ADD COLUMN abstract_summary TEXT') } catch (_) {}
  try { db.exec('ALTER TABLE reference_papers ADD COLUMN embedding_model TEXT') } catch (_) {}

  const savePaper = db.prepare(`
    INSERT INTO papers (id, title, authors, abstract, pdf_url, published_date,
      affiliations, pdf_text, summary, quiz, notes, pdf_error, status,
      pdf_text_source, ocr_error)
    VALUES (@id, @title, @authors, @abstract, @pdf_url, @published_date,
      @affiliations, @pdf_text, @summary, @quiz, @notes, @pdf_error, @status,
      @pdf_text_source, @ocr_error)
    ON CONFLICT(id) DO UPDATE SET
      title           = excluded.title,
      authors         = excluded.authors,
      abstract        = excluded.abstract,
      pdf_url         = excluded.pdf_url,
      published_date  = excluded.published_date,
      affiliations    = excluded.affiliations,
      pdf_text        = excluded.pdf_text,
      summary         = excluded.summary,
      quiz            = excluded.quiz,
      notes           = excluded.notes,
      pdf_error       = excluded.pdf_error,
      status          = excluded.status,
      pdf_text_source = excluded.pdf_text_source,
      ocr_error       = excluded.ocr_error
  `)

  const saveNotes      = db.prepare('UPDATE papers SET notes      = ? WHERE id = ?')
  const saveHighlights = db.prepare('UPDATE papers SET highlights = ? WHERE id = ?')
  const deletePaper  = db.prepare('DELETE FROM papers WHERE id = ?')

  const getPaper = db.prepare('SELECT * FROM papers WHERE id = ?')

  const getPapers = db.prepare('SELECT * FROM papers ORDER BY created_at DESC, rowid DESC')

  const updatePaperStatus = db.prepare('UPDATE papers SET status = ? WHERE id = ?')

  const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?')

  const saveSetting = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `)

  const getAllSettings = db.prepare('SELECT key, value FROM settings')

  const saveQuizResult = db.prepare(`
    INSERT INTO quiz_results (paper_id, score, total, answers, taken_at)
    VALUES (@paper_id, @score, @total, @answers, COALESCE(@taken_at, datetime('now')))
  `)

  const getQuizResults = db.prepare(
    'SELECT * FROM quiz_results WHERE paper_id = ? ORDER BY taken_at DESC, id DESC'
  )

  // "week_start" = Monday of the week a timestamp falls in, same (dayOfWeek + 6) % 7
  // idiom used in src/ingestion/arxiv.js and src/vault.js, expressed in SQL.
  const weekStartExpr = (col) =>
    `date(${col}, '-' || ((CAST(strftime('%w', ${col}) AS INTEGER) + 6) % 7) || ' days')`

  // Dashboard charts only ever count finished classes (clarity_score set by
  // class-end-session) — abandoned/incomplete sessions are excluded entirely,
  // not just from performance averages.
  const getClassSessionsByWeek = db.prepare(`
    SELECT ${weekStartExpr('created_at')} AS week_start, COUNT(*) AS count
    FROM class_sessions
    WHERE clarity_score IS NOT NULL
      AND (@from IS NULL OR date(created_at) >= @from) AND (@to IS NULL OR date(created_at) <= @to)
    GROUP BY week_start
    ORDER BY week_start
  `)

  const getClassPerformanceTrend = db.prepare(`
    SELECT ${weekStartExpr('created_at')} AS week_start,
           AVG(clarity_score) AS avg_clarity,
           AVG(CASE WHEN json_valid(feedback) THEN json_extract(feedback, '$.presentationScore') END) AS avg_presentation,
           AVG(CASE WHEN json_valid(feedback) THEN json_extract(feedback, '$.qaScore') END) AS avg_qa
    FROM class_sessions
    WHERE clarity_score IS NOT NULL
      AND (@from IS NULL OR date(created_at) >= @from) AND (@to IS NULL OR date(created_at) <= @to)
    GROUP BY week_start
    ORDER BY week_start
  `)

  const getQuizPerformanceTrend = db.prepare(`
    SELECT ${weekStartExpr('taken_at')} AS week_start,
           AVG(CAST(score AS REAL) / total * 100) AS avg_pct
    FROM quiz_results
    WHERE (@from IS NULL OR date(taken_at) >= @from) AND (@to IS NULL OR date(taken_at) <= @to)
    GROUP BY week_start
    ORDER BY week_start
  `)

  const getClassWeeks = db.prepare(`
    SELECT DISTINCT ${weekStartExpr('created_at')} AS week_start FROM class_sessions
    WHERE clarity_score IS NOT NULL
  `)

  const saveReferencePaper = db.prepare(`
    INSERT OR IGNORE INTO reference_papers (path, snippet, embedding, abstract_summary, embedding_model)
    VALUES (@path, @snippet, @embedding, @abstract_summary, @embedding_model)
  `)

  // Las filas indexadas antes de que existiera la columna sólo pudieron salir
  // del único proveedor que había entonces — se leen con ese sello, no como null.
  const embeddingModelExpr = `COALESCE(embedding_model, '${LEGACY_EMBEDDING_MODEL}')`

  // El WHERE del upsert es la regla clave: una fila 'manual' solo puede ser
  // pisada por otra 'manual'. Un refresh de LiteLLM la deja intacta, que es lo
  // que hace que un override del usuario sobreviva a la actualización semanal.
  const savePricingRow = db.prepare(`
    INSERT INTO pricing_cache
      (provider, model, prompt_price_per_token, completion_price_per_token,
       audio_price_per_second, unit, source, fetched_at)
    VALUES
      (@provider, @model, @prompt_price_per_token, @completion_price_per_token,
       @audio_price_per_second, @unit, @source, datetime('now'))
    ON CONFLICT (provider, model) DO UPDATE SET
      prompt_price_per_token     = excluded.prompt_price_per_token,
      completion_price_per_token = excluded.completion_price_per_token,
      audio_price_per_second     = excluded.audio_price_per_second,
      unit                       = excluded.unit,
      source                     = excluded.source,
      fetched_at                 = excluded.fetched_at
    WHERE pricing_cache.source <> 'manual' OR excluded.source = 'manual'
  `)

  const getPricingRow  = db.prepare('SELECT * FROM pricing_cache WHERE provider = ? AND model = ?')
  const getPricingRows = db.prepare('SELECT * FROM pricing_cache ORDER BY provider, model')

  const saveUsageEvent = db.prepare(`
    INSERT INTO usage_events
      (occurred_at, action_type, provider, model, prompt_tokens, completion_tokens, audio_seconds,
       units, prompt_price_per_token, completion_price_per_token, cost_micro_usd,
       paper_id, session_id)
    VALUES
      (COALESCE(@occurred_at, datetime('now')), @action_type, @provider, @model, @prompt_tokens,
       @completion_tokens, @audio_seconds, @units, @prompt_price_per_token,
       @completion_price_per_token, @cost_micro_usd, @paper_id, @session_id)
  `)

  const getUsageEvents      = db.prepare('SELECT * FROM usage_events ORDER BY occurred_at DESC')
  const getTotalCost        = db.prepare('SELECT COALESCE(SUM(cost_micro_usd), 0) AS total FROM usage_events')
  const getUnknownCostCount = db.prepare('SELECT COUNT(*) AS n FROM usage_events WHERE cost_micro_usd IS NULL')

  // Las agregaciones se hacen en SQL (no en JS) para que el dashboard siga
  // respondiendo con miles de eventos acumulados. groupBy nunca se interpola:
  // se resuelve contra este mapa, así una cadena arbitraria no puede entrar al SQL.
  // La semana arranca el LUNES, igual que el resto de la app (vault, dashboard
  // de aprendizaje) — no el domingo que asume strftime('%W').
  const PERIOD_EXPR = {
    day:   `date(occurred_at)`,
    week:  weekStartExpr('occurred_at'),
    month: `strftime('%Y-%m', occurred_at)`,
  }

  // El rango es inclusivo por día: `to` se compara contra la fecha, no contra el
  // timestamp, para que un evento de las 10:00 del último día no quede afuera.
  const RANGE_SQL = `
    AND (@from IS NULL OR date(occurred_at) >= date(@from))
    AND (@to   IS NULL OR date(occurred_at) <= date(@to))
  `

  const costBucketStmts = Object.fromEntries(Object.entries(PERIOD_EXPR).map(([key, expr]) => [
    key,
    db.prepare(`
      SELECT ${expr} AS period, provider, SUM(cost_micro_usd) AS total_micro_usd
      FROM usage_events
      WHERE cost_micro_usd IS NOT NULL ${RANGE_SQL}
      GROUP BY period, provider
      ORDER BY period
    `),
  ]))

  // Se agrupa también por modelo: "resumen con anthropic" sin saber el modelo no
  // alcanza para decidir nada — Opus y Haiku difieren 5x en precio.
  // SUM sin COALESCE a propósito: si el modelo no tenía precio, el total queda
  // NULL y la UI lo muestra como "—" (desconocido). Un COALESCE(...,0) lo
  // pintaría como gratis, que es justo lo que esconde gasto real.
  const getCostByAction = db.prepare(`
    SELECT action_type, provider, model, COUNT(*) AS events,
           SUM(cost_micro_usd) AS total_micro_usd
    FROM usage_events
    WHERE 1 = 1 ${RANGE_SQL}
    GROUP BY action_type, provider, model
    ORDER BY total_micro_usd DESC
  `)

  const getRangeTotal = db.prepare(`
    SELECT COALESCE(SUM(cost_micro_usd), 0) AS total
    FROM usage_events
    WHERE 1 = 1 ${RANGE_SQL}
  `)

  const getRangeUnknownCount = db.prepare(`
    SELECT COUNT(*) AS n FROM usage_events
    WHERE cost_micro_usd IS NULL ${RANGE_SQL}
  `)

  const getReferencePaper  = db.prepare('SELECT id FROM reference_papers WHERE path = ?')
  const getReferencePapers     = db.prepare(`SELECT path, snippet, embedding, abstract_summary, ${embeddingModelExpr} AS embedding_model FROM reference_papers`)
  const getReferencePapersList = db.prepare('SELECT id, path FROM reference_papers ORDER BY indexed_at DESC')
  const getReferenceCount      = db.prepare('SELECT COUNT(*) AS n FROM reference_papers')
  const getReferenceCountByModel = db.prepare(`SELECT COUNT(*) AS n FROM reference_papers WHERE ${embeddingModelExpr} = ?`)

  return {
    savePaper:         (paper) => savePaper.run({ notes: null, pdf_text_source: null, ocr_error: null, ...paper }),
    getPaper:          (id) => getPaper.get(id),
    getPapers:         () => getPapers.all(),
    updatePaperStatus: (id, status) => updatePaperStatus.run(status, id),
    getSetting:        (key) => getSetting.get(key)?.value,
    saveSetting:       (key, value) => saveSetting.run(key, value),
    getAllSettings:     () => {
      const rows = getAllSettings.all()
      return Object.fromEntries(rows.map(r => [r.key, r.value]))
    },
    saveQuizResult:    (result) => saveQuizResult.run({ taken_at: null, ...result }),
    getQuizResults:    (paperId) => getQuizResults.all(paperId),
    getClassSessionsByWeek:  (from = null, to = null) => getClassSessionsByWeek.all({ from, to }),
    getClassPerformanceTrend: (from = null, to = null) => getClassPerformanceTrend.all({ from, to }),
    getQuizPerformanceTrend:  (from = null, to = null) => getQuizPerformanceTrend.all({ from, to }),
    getWeeklyStreak: (referenceDate = new Date()) => {
      const weeksWithClass = new Set(getClassWeeks.all().map(r => r.week_start))
      if (weeksWithClass.size === 0) return { current: 0, best: 0 }

      const thisWeek = mondayOf(referenceDate)
      let cursor = weeksWithClass.has(thisWeek) ? thisWeek : addDays(thisWeek, -7)
      let current = 0
      while (weeksWithClass.has(cursor)) {
        current++
        cursor = addDays(cursor, -7)
      }

      const sorted = [...weeksWithClass].sort()
      let best = 0, run = 0, prev = null
      for (const week of sorted) {
        run = (prev !== null && addDays(prev, 7) === week) ? run + 1 : 1
        best = Math.max(best, run)
        prev = week
      }

      return { current, best }
    },
    saveNotes:           (id, notes)      => saveNotes.run(notes, id),
    saveHighlights:      (id, highlights) => saveHighlights.run(highlights, id),
    deletePaper:         (id) => deletePaper.run(id),
    savePricingRows: (rows) => {
      const defaults = {
        prompt_price_per_token: null, completion_price_per_token: null,
        audio_price_per_second: null, unit: null, source: 'litellm',
      }
      const write = db.transaction(list => {
        for (const r of list) savePricingRow.run({ ...defaults, ...r })
      })
      write(rows)
    },
    getPricingRow:  (provider, model) => getPricingRow.get(provider, model),
    getPricingRows: ()                => getPricingRows.all(),

    saveUsageEvent: (e) => {
      const defaults = {
        occurred_at: null,  // null → datetime('now')
        model: null, prompt_tokens: null, completion_tokens: null, audio_seconds: null,
        units: null, prompt_price_per_token: null, completion_price_per_token: null,
        cost_micro_usd: null, paper_id: null, session_id: null,
      }
      return saveUsageEvent.run({ ...defaults, ...e })
    },
    getUsageEvents:      () => getUsageEvents.all(),
    getTotalCostMicroUsd: () => getTotalCost.get().total,
    getUnknownCostCount:  () => getUnknownCostCount.get().n,

    getCostBuckets: ({ groupBy, from = null, to = null }) => {
      const stmt = costBucketStmts[groupBy]
      if (!stmt) throw new Error(`Granularidad inválida: ${groupBy}`)
      return stmt.all({ from, to })
    },
    getCostByAction:     ({ from = null, to = null } = {}) => getCostByAction.all({ from, to }),
    getRangeCost:        ({ from = null, to = null } = {}) => getRangeTotal.get({ from, to }).total,
    getRangeUnknownCount:({ from = null, to = null } = {}) => getRangeUnknownCount.get({ from, to }).n,

    saveReferencePaper:     (r)          => saveReferencePaper.run({ abstract_summary: null, embedding_model: null, ...r }),
    getReferencePaper:      (p)          => getReferencePaper.get(p),
    getReferencePapers:     ()           => getReferencePapers.all(),
    getReferencePapersList: ()           => getReferencePapersList.all(),
    getReferenceCount:      (model)      => model ? getReferenceCountByModel.get(model).n : getReferenceCount.get().n,
    deleteReferencePaper:   (p)          => db.prepare('DELETE FROM reference_papers WHERE path = ?').run(p),
    updatePaperTitle:       (id, title)  => db.prepare('UPDATE papers SET title = ? WHERE id = ?').run(title, id),

    createClassSession:  (data) => {
      const r = db.prepare('INSERT INTO class_sessions (paper_id, duration) VALUES (@paper_id, @duration)').run(data)
      return { id: r.lastInsertRowid }
    },
    updateClassSession:  (id, updates) => {
      const sets = Object.keys(updates).map(k => `${k} = @${k}`).join(', ')
      db.prepare(`UPDATE class_sessions SET ${sets} WHERE id = @id`).run({ id, ...updates })
    },
    getClassSession:    (id)      => db.prepare('SELECT * FROM class_sessions WHERE id = ?').get(id),
    getClassSessions:   (paperId) => db.prepare('SELECT * FROM class_sessions WHERE paper_id = ? ORDER BY created_at DESC').all(paperId),
    saveClassSlide:     (data) => {
      const r = db.prepare(
        'INSERT INTO class_slides (session_id, order_index, image_data, mime_type, label) VALUES (@session_id, @order_index, @image_data, @mime_type, @label)'
      ).run(data)
      return { id: r.lastInsertRowid }
    },
    getClassSlides:              (sessionId) => db.prepare('SELECT * FROM class_slides WHERE session_id = ? ORDER BY order_index').all(sessionId),
    updateClassSlideInterpretation: (id, interpretation) => db.prepare('UPDATE class_slides SET interpretation = ? WHERE id = ?').run(interpretation, id),

    close:               () => db.close()
  }
}

module.exports = { openDatabase }