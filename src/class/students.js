const { parseJSONResponse } = require('../llm/prompts')
const { buildTurnInstruction, buildHistoryBlock, buildPreviousQABlock, buildStudentSystemPrompt, buildSlidesBlock } = require('./prompts')

const STUDENTS = [
  {
    id: 1,
    name: 'María García',
    role: 'estudiante de posgrado en investigación',
    emoji: '👩‍🎓',
    color: '#6366f1',
    trait: 'Eres rigurosa, analítica, y te interesa la precisión metodológica. Haces preguntas sobre cómo se diseñó el experimento, qué métricas se usaron y si el método es reproducible.',
    systemPrompt(paper, slides) { return buildStudentSystemPrompt(this, paper, slides) }
  },
  {
    id: 2,
    name: 'Carlos Reyes',
    role: 'ingeniero de software interesado en investigación aplicada',
    emoji: '🧑‍💻',
    color: '#10b981',
    trait: 'Eres curioso sobre implementación y casos de uso. Te interesa entender cómo aplicar esto en proyectos reales, qué herramientas se necesitan y cuáles son los trade-offs prácticos.',
    systemPrompt(paper, slides) { return buildStudentSystemPrompt(this, paper, slides) }
  },
  {
    id: 3,
    name: 'Sofía Kim',
    role: 'investigadora crítica con enfoque en validación científica',
    emoji: '👩‍🔬',
    color: '#f59e0b',
    trait: 'Eres crítica constructiva. Te interesan los supuestos del paper, sus limitaciones, qué no se probó y qué trabajo queda pendiente.',
    systemPrompt(paper, slides) { return buildStudentSystemPrompt(this, paper, slides) }
  }
]

async function generateTurn(student, context, llm) {
  const { paper, slides, history, previousQA, transcript } = context
  const isFirst = !history || history.length === 0

  const slidesBlock = buildSlidesBlock(slides)
  const transcriptBlock = transcript
    ? `\n\nLo que el profesor dijo en su presentación:\n"""\n${transcript}\n"""`
    : ''
  const prevBlock = buildPreviousQABlock(previousQA)

  const contextMsg = `El profesor acaba de terminar su presentación.${slidesBlock}${transcriptBlock}${prevBlock}`

  const messages = [
    { role: 'system', content: student.systemPrompt(paper, slides) },
    { role: 'user', content: contextMsg }
  ]

  for (const h of (history || [])) {
    messages.push({ role: 'assistant', content: h.question })
    if (h.answer) messages.push({ role: 'user', content: h.answer })
  }

  messages.push({
    role: 'user',
    content: isFirst
      ? `${buildTurnInstruction([])}\nResponde solo con el saludo + pregunta. Sin explicaciones.`
      : `${buildTurnInstruction(history)}\nResponde de forma natural y coherente con lo que el profesor realmente dijo. Si no respondió la pregunta o fue vago, rediríjelo con calma hacia la pregunta. Si respondió pero faltaron detalles, pide la aclaración específica. Nunca agradezcas ni elogies una respuesta que no lo mereció.`
  })

  const response = await llm.chat(messages)
  console.log('[generateTurn] raw response:', JSON.stringify(response)?.slice(0, 200))
  const text = (response || '').trim()
  if (!text) throw new Error('LLM returned empty response')
  return text
}

async function evaluateAndReact(student, context, llm) {
  const { paper, slides, history, exchangeCount } = context
  const isLastRound = exchangeCount >= 4
  const messages = [
    { role: 'system', content: student.systemPrompt(paper, slides) },
    { role: 'user', content: 'El profesor terminó su explicación.' }
  ]

  for (const h of (history || [])) {
    messages.push({ role: 'assistant', content: h.question })
    if (h.answer) messages.push({ role: 'user', content: h.answer })
  }

  const closingInstruction = isLastRound
    ? `Esta es la última ronda de intercambio. Evalúa la respuesta del profesor:
- Si fue clara y completa: agradece de forma natural y marca satisfied: true.
- Si no fue suficiente o fue vaga: de todas formas marca satisfied: true y cierra con amabilidad, algo como "No se preocupe, creo que lo entiendo, gracias." — es el momento de cerrar, no de insistir.`
    : `- Si la respuesta fue clara y completa: marca satisfied: true y agradece.
- Si el profesor no supo, fue vago o respondió algo sin sentido: SIEMPRE marca satisfied: false, sigue insistiendo con curiosidad y reformula la pregunta de otro ángulo. Nunca te rindas antes de tiempo.`

  messages.push({
    role: 'user',
    content: `Basándote en toda la conversación, reacciona a la última respuesta del profesor de forma natural.
${closingInstruction}
Responde con JSON exacto:
{"satisfied": true/false, "reaction": "frase corta y natural dirigida al profesor (max 25 palabras)", "missing": "qué faltó si no estás satisfecho (null si sí)"}`
  })
  try {
    const raw = await llm.chat(messages)
    const result = parseJSONResponse(raw)
    return {
      satisfied: isLastRound ? true : Boolean(result.satisfied),
      reaction: result.reaction || (result.satisfied ? 'Gracias, quedó claro.' : 'Hmm, todavía tengo dudas.'),
      missing: result.missing || null
    }
  } catch {
    return {
      satisfied: isLastRound ? true : false,
      reaction: isLastRound ? 'No se preocupe, creo que lo entiendo. Gracias.' : 'No quedó del todo claro.',
      missing: null
    }
  }
}

async function evaluateClarity(context, llm) {
  const { paper, transcript, qaLog } = context
  const qaText = (qaLog || []).map((qa, i) =>
    `Estudiante ${i + 1}: ${qa.question}\nProfesor: ${qa.professorAnswer}`
  ).join('\n\n')
  const messages = [{
    role: 'user',
    content: `Eres un evaluador experto de presentaciones académicas.
Paper evaluado: ${paper.title}
Abstract: ${paper.abstract || ''}

Transcripción del profesor durante la presentación:
${transcript || '(sin transcripción)'}

Intercambio de preguntas y respuestas:
${qaText || '(sin Q&A)'}

Evalúa la presentación y responde con JSON:
{"score": <entero 0-100>, "feedback": "<2-3 oraciones de feedback constructivo>", "strengths": "<qué explicó bien>", "improvements": "<qué podría mejorar>"}`
  }]
  try {
    const raw = await llm.chat(messages)
    return parseJSONResponse(raw)
  } catch {
    return { score: 70, feedback: 'Presentación completada.', strengths: '', improvements: '' }
  }
}

async function evaluatePresentation(context, llm) {
  const { paper, transcript } = context
  const messages = [{
    role: 'user',
    content: `Eres un evaluador de presentaciones académicas orales.

Paper: ${paper.title}
Abstract: ${paper.abstract || ''}

Transcripción de la presentación (lo que dijo el profesor en voz alta):
${transcript || '(sin transcripción disponible)'}

Evalúa ÚNICAMENTE la calidad de la presentación oral: claridad de la explicación,
estructura, profundidad conceptual y capacidad de síntesis del contenido del paper.
NO evalúes preguntas ni respuestas — solo la exposición inicial.

Responde con JSON exacto:
{"score": <entero 0-100>, "feedback": "<2-3 oraciones de feedback constructivo>", "strengths": "<qué explicó bien>", "improvements": "<qué podría mejorar>"}`
  }]
  try {
    const raw = await llm.chat(messages)
    return parseJSONResponse(raw)
  } catch {
    return { score: 0, feedback: 'No se pudo evaluar la presentación.', strengths: '', improvements: '' }
  }
}

module.exports = { STUDENTS, generateTurn, evaluateAndReact, evaluateClarity, evaluatePresentation }