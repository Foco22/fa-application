const { canHaveClass, STUDENTS, generateTurn, evaluateAndReact, evaluateClarity, evaluatePresentation, generateHint, assistantChat } = require('../class')

function registerClassHandlers({ ipcMain, db, deps }) {
  const { createLLM, createTranscription } = deps

  function createClassLLM(settings) {
    return createLLM({
      ...settings,
      llmProvider: settings.classLlmProvider || 'deepseek',
      llmModel:    settings.classLlmModel    || 'deepseek-v4-flash',
      apiKey:      settings.classApiKey      || settings.apiKey
    })
  }

  ipcMain.handle('class-can-have-class', (_e, paperId) => {
    const paper = db.getPaper(paperId)
    return canHaveClass(paper)
  })

  ipcMain.handle('class-upload-slides', (_e, { paperId, duration, slides }) => {
    const session = db.createClassSession({ paper_id: paperId, duration })
    const sessionId = session.id
    const slideIds = slides.map((s, i) => {
      const autoLabel = i === 0 ? 'intro' : i === slides.length - 1 ? 'conclusion' : 'desarrollo'
      const slide = db.saveClassSlide({
        session_id: sessionId,
        order_index: i,
        image_data: s.imageData,
        mime_type: s.mimeType || 'image/jpeg',
        label: s.label || autoLabel
      })
      return slide.id
    })
    return { sessionId, slideIds }
  })

  ipcMain.handle('class-interpret-slides', async (_e, { sessionId }) => {
    const settings = db.getAllSettings()
    const llm = createClassLLM(settings)
    if (!llm.interpretImage) return { slides: [] }
    const slides = db.getClassSlides(sessionId)
    const results = []
    for (const slide of slides) {
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

  ipcMain.handle('class-student-question', async (_e, { studentId, paperId, sessionId, history, previousQA, reaction }) => {
    const student = STUDENTS.find(s => s.id === studentId)
    if (!student) return { question: '¿Podría explicar más sobre el método?' }
    try {
      const settings = db.getAllSettings()
      const llm = createClassLLM(settings)
      const paper = db.getPaper(paperId)
      const slides = db.getClassSlides(sessionId)
      const question = await generateTurn(student, { paper, slides, history: history || [], previousQA: previousQA || [], reaction: reaction || null }, llm)
      return { question }
    } catch (err) {
      console.error('[class-student-question]', err?.message || err)
      return { question: '¿Podría elaborar más sobre los resultados?' }
    }
  })

  ipcMain.handle('class-student-evaluate', async (_e, { studentId, paperId, sessionId, professorAnswer, history, exchangeCount }) => {
    const settings = db.getAllSettings()
    const llm = createClassLLM(settings)
    const paper = db.getPaper(paperId)
    const slides = db.getClassSlides(sessionId)
    const student = STUDENTS.find(s => s.id === studentId)
    if (!student) return { satisfied: true, reaction: 'Gracias.', missing: null }
    try {
      return await evaluateAndReact(student, { paper, slides, professorAnswer, history: history || [], exchangeCount: exchangeCount || 0 }, llm)
    } catch (err) {
      console.error('[class-student-evaluate]', err?.message || err)
      return { satisfied: true, reaction: 'Gracias por la respuesta.', missing: null }
    }
  })

  ipcMain.handle('class-end-session', async (_e, { sessionId, transcript, qaLog }) => {
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

  ipcMain.handle('class-assistant-message', async (_e, { paperId, message, question, missing, excerpts, history, canRevealAnswer }) => {
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

  ipcMain.handle('class-transcribe-audio', async (_e, { audio, mimeType, language, model }) => {
    const settings = db.getAllSettings()
    const apiKey = settings.openaiApiKey || settings.apiKey
    if (!apiKey) return { text: null, error: 'Configura una API key en Settings' }

    try {
      const transcription = createTranscription(apiKey, { model })
      return await transcription.transcribe(audio, mimeType, language)
    } catch (err) {
      return { text: null, error: err.message }
    }
  })
}

module.exports = { registerClassHandlers }
