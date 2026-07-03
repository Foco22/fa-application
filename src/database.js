const Database = require('better-sqlite3')

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
      indexed_at        DATETIME DEFAULT (datetime('now'))
    );
  `)

  // Migrate: add columns if they don't exist yet (existing DBs)
  try { db.exec('ALTER TABLE papers ADD COLUMN notes TEXT') } catch (_) {}
  try { db.exec('ALTER TABLE papers ADD COLUMN highlights TEXT') } catch (_) {}
  try { db.exec('ALTER TABLE reference_papers ADD COLUMN abstract_summary TEXT') } catch (_) {}

  const savePaper = db.prepare(`
    INSERT INTO papers (id, title, authors, abstract, pdf_url, published_date,
      affiliations, pdf_text, summary, quiz, notes, pdf_error, status)
    VALUES (@id, @title, @authors, @abstract, @pdf_url, @published_date,
      @affiliations, @pdf_text, @summary, @quiz, @notes, @pdf_error, @status)
    ON CONFLICT(id) DO UPDATE SET
      title          = excluded.title,
      authors        = excluded.authors,
      abstract       = excluded.abstract,
      pdf_url        = excluded.pdf_url,
      published_date = excluded.published_date,
      affiliations   = excluded.affiliations,
      pdf_text       = excluded.pdf_text,
      summary        = excluded.summary,
      quiz           = excluded.quiz,
      notes          = excluded.notes,
      pdf_error      = excluded.pdf_error,
      status         = excluded.status
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
    INSERT INTO quiz_results (paper_id, score, total, answers)
    VALUES (@paper_id, @score, @total, @answers)
  `)

  const getQuizResults = db.prepare(
    'SELECT * FROM quiz_results WHERE paper_id = ? ORDER BY taken_at DESC, id DESC'
  )

  const saveReferencePaper = db.prepare(`
    INSERT OR IGNORE INTO reference_papers (path, snippet, embedding, abstract_summary)
    VALUES (@path, @snippet, @embedding, @abstract_summary)
  `)

  const getReferencePaper  = db.prepare('SELECT id FROM reference_papers WHERE path = ?')
  const getReferencePapers     = db.prepare('SELECT path, snippet, embedding, abstract_summary FROM reference_papers')
  const getReferencePapersList = db.prepare('SELECT id, path FROM reference_papers ORDER BY indexed_at DESC')
  const getReferenceCount      = db.prepare('SELECT COUNT(*) AS n FROM reference_papers')

  return {
    savePaper:         (paper) => savePaper.run({ notes: null, ...paper }),
    getPaper:          (id) => getPaper.get(id),
    getPapers:         () => getPapers.all(),
    updatePaperStatus: (id, status) => updatePaperStatus.run(status, id),
    getSetting:        (key) => getSetting.get(key)?.value,
    saveSetting:       (key, value) => saveSetting.run(key, value),
    getAllSettings:     () => {
      const rows = getAllSettings.all()
      return Object.fromEntries(rows.map(r => [r.key, r.value]))
    },
    saveQuizResult:    (result) => saveQuizResult.run(result),
    getQuizResults:    (paperId) => getQuizResults.all(paperId),
    saveNotes:           (id, notes)      => saveNotes.run(notes, id),
    saveHighlights:      (id, highlights) => saveHighlights.run(highlights, id),
    deletePaper:         (id) => deletePaper.run(id),
    saveReferencePaper:     (r)          => saveReferencePaper.run({ abstract_summary: null, ...r }),
    getReferencePaper:      (p)          => getReferencePaper.get(p),
    getReferencePapers:     ()           => getReferencePapers.all(),
    getReferencePapersList: ()           => getReferencePapersList.all(),
    getReferenceCount:      ()           => getReferenceCount.get().n,
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