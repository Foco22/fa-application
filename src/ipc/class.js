const path = require('path')
const fs   = require('fs')
const { pathToFileURL } = require('url')
const { canHaveClass, STUDENTS, generateTurn, evaluateAndReact, evaluateClarity, evaluatePresentation, generateReferenceAnswer, generateHint, assistantChat } = require('../class')

// Tope de un deck/borrador en markdown: evita filas gigantes en SQLite por un
// payload malformado (el renderer es de confianza, esto es defensa en profundidad).
const MAX_MARKDOWN_BYTES = 1024 * 1024
const MAX_REFERENCE_CACHE = 100

function isValidMarkdown(md) {
  return typeof md === 'string' && Buffer.byteLength(md, 'utf8') <= MAX_MARKDOWN_BYTES
}

function registerClassHandlers({ ipcMain, db, deps, mainWindow }) {
  const { createLLM, createTranscription, createWhisperStream, whisperStreamBin, whisperModelsDir, vault, dialog } = deps

  let _whisperStream = null
  // Respuesta correcta por pregunta (sessionId::pregunta): se genera en el
  // primer intento del profesor y se reutiliza en los siguientes.
  const _referenceAnswers = new Map()

  function cacheReferenceAnswer(key, answer) {
    if (_referenceAnswers.size >= MAX_REFERENCE_CACHE) {
      _referenceAnswers.delete(_referenceAnswers.keys().next().value)   // la más antigua
    }
    _referenceAnswers.set(key, answer)
  }

  function clearSessionReferenceAnswers(sessionId) {
    const prefix = `${sessionId}::`
    for (const key of _referenceAnswers.keys()) {
      if (key.startsWith(prefix)) _referenceAnswers.delete(key)
    }
  }

  // El modo Clase (pistas, evaluaciones, Q&A) usa siempre el LLM principal de
  // la app — sin proveedor/modelo/API key propios de Clase. Ver features/settings-redesign.md.
  function createClassLLM(settings) {
    return createLLM(settings)
  }

  ipcMain.handle('class-can-have-class', (_e, paperId) => {
    const paper = db.getPaper(paperId)
    return canHaveClass(paper)
  })

  ipcMain.handle('class-upload-slides', async (_e, { paperId, duration, slides }) => {
    // Validar TODO antes de escribir: un slide malformado a mitad de camino
    // dejaría una sesión creada con slides parciales.
    if (!Array.isArray(slides) || slides.length === 0) {
      throw new Error('class-upload-slides: slides debe ser una lista no vacía')
    }
    for (const s of slides) {
      if (!s || (s.markdown != null && !isValidMarkdown(s.markdown))) {
        throw new Error('class-upload-slides: slide inválida (markdown no es texto o supera el tope)')
      }
    }
    const session = db.createClassSession({ paper_id: paperId, duration })
    const sessionId = session.id
    const paper = db.getPaper(paperId)
    const slideIds = slides.map((s, i) => {
      const autoLabel = i === 0 ? 'intro' : i === slides.length - 1 ? 'conclusion' : 'desarrollo'
      if (s.markdown != null) {
        const slide = db.saveClassSlide({
          session_id: sessionId, order_index: i, markdown: s.markdown, label: s.label || autoLabel
        })
        // El markdown ya ES la descripción textual de la slide: los estudiantes
        // lo leen directo, sin pasar por visión (interpret-slides la salta).
        db.updateClassSlideInterpretation(slide.id, s.markdown)
        return slide.id
      }
      const slide = db.saveClassSlide({
        session_id: sessionId,
        order_index: i,
        image_data: s.imageData,
        mime_type: s.mimeType || 'image/jpeg',
        label: s.label || autoLabel
      })
      // Además de la DB, persistir la imagen en <paper>/slides/ del vault, junto
      // al PDF (raw/) y los assets generados. Un fallo de disco no debe romper
      // la subida: la DB sigue siendo la fuente de verdad para la Clase.
      if (vault && vault.writeSlide && paper && s.imageData) {
        try {
          const ext = (s.mimeType || 'image/jpeg').includes('png') ? 'png' : 'jpg'
          const filename = `slide-${String(i + 1).padStart(2, '0')}.${ext}`
          vault.writeSlide(paper, filename, Buffer.from(s.imageData, 'base64'))
        } catch (err) {
          console.error('[class-upload-slides] no se pudo escribir la slide al vault:', err.message)
        }
      }
      return slide.id
    })
    // Un deck markdown va al vault como un solo slides.md (mismo separador ---
    // que usa el editor), no como un archivo por slide.
    const mdSlides = slides.filter(s => s.markdown != null).map(s => s.markdown.trim())
    if (mdSlides.length && vault && vault.writeSlide && paper) {
      try {
        vault.writeSlide(paper, 'slides.md', Buffer.from(mdSlides.join('\n\n---\n\n') + '\n', 'utf8'))
      } catch (err) {
        console.error('[class-upload-slides] no se pudo escribir slides.md al vault:', err.message)
      }
    }
    return { sessionId, slideIds }
  })

  ipcMain.handle('class-save-slides-draft', (_e, { paperId, markdown } = {}) => {
    if (typeof paperId !== 'string' || !isValidMarkdown(markdown)) {
      return { ok: false, error: 'Borrador inválido' }
    }
    db.saveSlidesDraft(paperId, markdown)
    return { ok: true }
  })

  // PDF propio del usuario (ej. uno exportado con sus destacados desde otro
  // lector) para tenerlo al lado mientras escribe las slides.
  ipcMain.handle('class-pick-pdf', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (result.canceled || !result.filePaths.length) return null
    const filePath = result.filePaths[0]
    if (path.extname(filePath).toLowerCase() !== '.pdf') return null
    return { url: pathToFileURL(filePath).href, name: path.basename(filePath) }
  })

  ipcMain.handle('class-interpret-slides', async (_e, { sessionId }) => {
    const settings = db.getAllSettings()
    const llm = createClassLLM(settings)
    const slides = db.getClassSlides(sessionId)
    const results = []
    for (const slide of slides) {
      // Ya interpretada (las slides markdown traen su propio texto) → no gastar visión.
      if (slide.interpretation) {
        results.push({ id: slide.id, interpretation: slide.interpretation })
        continue
      }
      if (!llm.interpretImage) {
        results.push({ id: slide.id, interpretation: null })
        continue
      }
      try {
        const interpretation = await llm.interpretImage(slide.image_data, slide.mime_type)
        if (interpretation) db.updateClassSlideInterpretation(slide.id, interpretation)
        results.push({ id: slide.id, interpretation: interpretation || null })
      } catch (err) {
        results.push({ id: slide.id, interpretation: null, error: err.message })
      }
    }
    return { slides: results }
  })

  ipcMain.handle('class-start-session', (_e, { sessionId }) => {
    const session = db.getClassSession(sessionId)
    const slides = db.getClassSlides(sessionId)
    return { session, slides }
  })

  ipcMain.handle('class-get-slides', (_e, sessionId) => {
    return db.getClassSlides(sessionId)
  })

  ipcMain.handle('class-save-transcript', (_e, { sessionId, transcript }) => {
    db.updateClassSession(sessionId, { transcript })
  })

  ipcMain.handle('class-student-question', async (_e, { studentId, paperId, sessionId, history, previousQA, reaction, transcript }) => {
    const student = STUDENTS.find(s => s.id === studentId)
    if (!student) return { question: '¿Podría explicar más sobre el método?' }
    try {
      const settings = db.getAllSettings()
      const llm = createClassLLM(settings)
      const paper = db.getPaper(paperId)
      const slides = db.getClassSlides(sessionId)
      const question = await generateTurn(student, { paper, slides, history: history || [], previousQA: previousQA || [], reaction: reaction || null, transcript: transcript || null }, llm)
      return { question }
    } catch (err) {
      console.error('[class-student-question]', err?.message || err)
      return { question: '¿Podría elaborar más sobre los resultados?' }
    }
  })

  ipcMain.handle('class-student-evaluate', async (_e, { studentId, paperId, sessionId, professorAnswer, history, exchangeCount }) => {
    const student = STUDENTS.find(s => s.id === studentId)
    if (!student) return { satisfied: true, reaction: 'Gracias.', missing: null }
    try {
      const settings = db.getAllSettings()
      const llm = createClassLLM(settings)
      const paper = db.getPaper(paperId)
      const slides = db.getClassSlides(sessionId)
      const question = (history || [])[0]?.question || ''
      const refKey = `${sessionId}::${question}`
      if (question && !_referenceAnswers.has(refKey)) {
        // Un fallo transitorio (red, rate limit) devuelve null: no se cachea,
        // para que el siguiente intento del profesor lo reintente.
        const generated = await generateReferenceAnswer(paper, question, llm)
        if (generated) cacheReferenceAnswer(refKey, generated)
      }
      const referenceAnswer = _referenceAnswers.get(refKey) || null
      return await evaluateAndReact(student, { paper, slides, professorAnswer, history: history || [], exchangeCount: exchangeCount || 0, referenceAnswer }, llm)
    } catch (err) {
      console.error('[class-student-evaluate]', err?.message || err)
      // Un error no cuenta como respuesta aceptada: el estudiante mantiene el turno.
      return { satisfied: false, reaction: 'No quedó del todo claro, ¿me lo podría explicar de otra forma?', missing: null }
    }
  })

  ipcMain.handle('class-end-session', async (_e, { sessionId, transcript, qaLog }) => {
    clearSessionReferenceAnswers(sessionId)
    const settings = db.getAllSettings()
    const llm = createClassLLM(settings)
    const session = db.getClassSession(sessionId)
    const paper = db.getPaper(session.paper_id)

    // Q&A score: algorithmic, no LLM needed
    const HINT_SCORES = { 0: 100, 1: 70, 2: 40, 3: 0 }
    const perStudent = (qaLog || []).map(qa => ({
      ...qa,
      score: HINT_SCORES[qa.hintLevel ?? 0] ?? 100
    }))
    const qaScore = perStudent.length
      ? Math.round(perStudent.reduce((s, q) => s + q.score, 0) / perStudent.length)
      : 70

    // Presentation score: LLM evaluates transcript only
    let presResult = { score: 0, feedback: 'Sin transcripción disponible.', strengths: '', improvements: 'El profesor no habló durante la presentación o no se capturó audio.' }
    if (transcript && transcript.trim().length > 30) {
      try {
        presResult = await evaluatePresentation({ paper, transcript }, llm)
      } catch (err) {
        console.error('[class-end-session] presentation', err?.message || err)
        presResult = { score: 0, feedback: 'No se pudo evaluar la presentación.', strengths: '', improvements: '' }
      }
    }

    const overallScore = Math.round(((presResult.score ?? 70) + qaScore) / 2)
    const feedbackObj = {
      presentationScore: presResult.score ?? 70,
      qaScore,
      presentationFeedback: presResult.feedback || '',
      presentationStrengths: presResult.strengths || '',
      presentationImprovements: presResult.improvements || '',
      perStudent
    }
    db.updateClassSession(sessionId, {
      transcript: transcript || '',
      clarity_score: overallScore,
      feedback: JSON.stringify(feedbackObj),
      qa_summary: JSON.stringify(qaLog || [])
    })
    return {
      presentationScore: presResult.score ?? 70,
      qaScore,
      presentationFeedback: presResult,
      perStudent
    }
  })

  ipcMain.handle('class-get-sessions', (_e, paperId) => {
    return db.getClassSessions(paperId)
  })

  ipcMain.handle('class-get-hint', async (_e, { studentId, paperId, history, exchangeCount, missing }) => {
    const paper = db.getPaper(paperId)
    const student = STUDENTS.find(s => s.id === studentId)
    const settings = db.getAllSettings()
    const llm = createClassLLM(settings)
    try {
      return await generateHint(student, { paper, history: history || [], exchangeCount, missing }, llm)
    } catch {
      return { excerpts: [], guidance: null, answer: null }
    }
  })

  ipcMain.handle('class-assistant-message', async (_e, { question, missing, excerpts, history, canRevealAnswer }) => {
    const settings = db.getAllSettings()
    const llm = createClassLLM(settings)
    try {
      const reply = await assistantChat({ question, missing, excerpts, history: history || [], canRevealAnswer: !!canRevealAnswer }, llm)
      return { reply }
    } catch (err) {
      console.error('[class-assistant-message]', err?.message || err)
      return { reply: null }
    }
  })

  ipcMain.handle('class-start-stream', (_e, { language = 'es', localModel = 'small' } = {}) => {
    if (!whisperStreamBin || !whisperModelsDir) {
      return { error: 'whisper.cpp no instalado. Compila tools/whisper.cpp/stream y descarga el modelo.' }
    }
    const modelPath = path.join(whisperModelsDir, `ggml-${localModel}.bin`)
    if (!fs.existsSync(modelPath)) {
      return { error: `Modelo "${localModel}" no encontrado. Descárgalo: bash models/download-ggml-model.sh ${localModel}` }
    }
    if (_whisperStream) { _whisperStream.stop(); _whisperStream = null }
    _whisperStream = createWhisperStream(whisperStreamBin, modelPath)
    _whisperStream.start({
      language,
      onText:  (text) => {
        console.log('[whisper-text]', text)
        mainWindow?.webContents.send('class-stream-text', text)
      },
      onDebug: (msg)  => {
        console.log('[whisper-debug]', msg)
        mainWindow?.webContents.send('class-stream-debug', msg)
      },
      onError: (err)  => {
        console.error('[whisper-error]', err.message)
        mainWindow?.webContents.send('class-stream-debug', `[error] ${err.message}`)
      }
    })
    return { ok: true }
  })

  ipcMain.handle('class-stop-stream', () => {
    _whisperStream?.stop()
    _whisperStream = null
    return { ok: true }
  })

  ipcMain.handle('class-transcribe-audio', async (_e, { audio, mimeType, language, model, prompt, provider }) => {
    const settings = db.getAllSettings()
    const isGroq   = provider === 'groq'
    const apiKey   = isGroq
      ? settings.groqApiKey
      : (settings.openaiApiKey || settings.apiKey)
    if (!apiKey) return { text: null, error: isGroq
      ? 'Agrega tu Groq API Key en Settings → Transcripción'
      : 'Configura una API key en Settings' }

    try {
      const transcription = createTranscription(apiKey, { model, provider })
      const result = await transcription.transcribe(audio, mimeType, language, prompt)
      console.log(`[transcribe] provider=${provider} model=${model} bytes=${audio?.length} text="${(result?.text||'').slice(0,80)}"`)
      return result
    } catch (err) {
      console.error(`[transcribe] error provider=${provider}:`, err.message)
      return { text: null, error: err.message }
    }
  })
}

module.exports = { registerClassHandlers }
