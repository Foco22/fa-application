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

// Palabras que, solas, no responden nada: saludos, muletillas y "no sé".
// Si la respuesta del profesor está hecha SOLO de esto, no es un intento de
// respuesta — no se le pregunta al LLM si le parece suficiente.
const NON_ANSWER_WORDS = new Set([
  'hola', 'buenas', 'buenos', 'buen', 'dias', 'tardes', 'noches', 'hey', 'saludos',
  'ok', 'okay', 'oka', 'vale', 'si', 'no', 'se', 'lo', 'la', 'el', 'verdad', 'idea', 'ni', 'tengo',
  'estoy', 'seguro', 'segura', 'recuerdo', 'paso', 'siguiente', 'bueno', 'pues', 'este', 'esto',
  'gracias', 'profesor', 'profe', 'sinceramente', 'honestamente', 'la', 'verdad',
  'mmm', 'mm', 'hmm', 'eh', 'ehh', 'ah', 'um', 'uh', 'em',
  'i', 'dont', 'do', 'not', 'know', 'hi', 'hello', 'sure', 'idk',
  'maria', 'carlos', 'sofia',
])

function isNonAnswer(text) {
  const words = (text || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // sé → se, maría → maria
    .replace(/[\u2019']/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  return words.every(w => NON_ANSWER_WORDS.has(w) || /^(m+|h?m+|e+h*|a+h+)$/.test(w))
}

// Respuesta correcta a la pregunta del estudiante según el paper. Se genera una
// vez por pregunta (la cachea el IPC) y es la vara contra la que el evaluador
// compara lo que dijo el profesor. null si falla: el evaluador entonces juzga
// contra el texto del paper directamente.
async function generateReferenceAnswer(paper, question, llm) {
  const messages = [{
    role: 'user',
    content: `Eres un experto en este paper. Responde la pregunta de forma correcta, concreta y basada SOLO en el paper.
Título: ${paper?.title || ''}
Abstract: ${paper?.abstract || ''}
Texto del paper: ${(paper?.pdf_text || '').slice(0, 12000)}

Pregunta: ${question}

Responde en 2-4 oraciones con los puntos clave que una buena respuesta debe cubrir. Solo la respuesta, sin preámbulo.`
  }]
  try {
    const text = (await llm.chat(messages) || '').trim()
    return text || null
  } catch {
    return null
  }
}

// Evaluador independiente de la persona del estudiante: compara la pregunta,
// TODAS las respuestas del profesor en este turno (una puede completar a la
// anterior) y la respuesta correcta. Devuelve { passed, missing }.
async function judgeAnswer({ paper, question, answers, referenceAnswer }, llm) {
  const reference = referenceAnswer
    ? `RESPUESTA CORRECTA (según el paper):\n${referenceAnswer}`
    : `TEXTO DEL PAPER (de aquí sale la respuesta correcta):\n${(paper?.pdf_text || paper?.abstract || '').slice(0, 8000)}`
  const messages = [{
    role: 'user',
    content: `Eres un evaluador estricto pero justo de una clase. Un estudiante hizo una pregunta y el profesor respondió (puede que en varios intentos).

PREGUNTA DEL ESTUDIANTE:
${question}

${reference}

RESPUESTAS DEL PROFESOR (en orden):
${answers.map((a, i) => `${i + 1}. ${a}`).join('\n')}

Decide si, tomadas en conjunto, las respuestas del profesor contestan el núcleo de la pregunta de forma correcta y consistente con la respuesta correcta. No exijas las mismas palabras ni todos los detalles, pero sí la idea central correcta.
- Saludos, "no sé", algo fuera de tema, o frases vagas que no explican nada → passed: false.
- Una respuesta incorrecta o que contradice el paper → passed: false.
Responde SOLO con JSON exacto:
{"passed": true/false, "missing": "qué idea clave falta o está mal, en una frase (null si passed)"}`
  }]
  const result = parseJSONResponse(await llm.chat(messages))
  // "false" como string es truthy: solo cuenta un true explícito.
  const passed = result.passed === true || result.passed === 'true'
  return { passed, missing: passed ? null : (result.missing || 'la idea central de la pregunta') }
}

// El veredicto lo da judgeAnswer; el estudiante solo reacciona a él con su voz.
// Nunca pasa por cansancio ni por un error: si el profesor no sabe, para eso
// están las pistas (campanita → guía → respuesta) en el renderer.
async function evaluateAndReact(student, context, llm) {
  const { paper, slides, history, referenceAnswer } = context
  const turn = history || []
  const question = turn[0]?.question || ''
  const answers = turn.map(h => h.answer).filter(a => a && a.trim())
  if (!answers.length && context.professorAnswer) answers.push(context.professorAnswer)
  const lastAnswer = answers.at(-1) || ''

  if (isNonAnswer(lastAnswer)) {
    return {
      satisfied: false,
      reaction: 'Creo que todavía no respondió mi pregunta. ¿Me la podría explicar?',
      missing: question || 'responder la pregunta'
    }
  }

  let verdict
  try {
    verdict = await judgeAnswer({ paper, question, answers, referenceAnswer }, llm)
  } catch {
    return {
      satisfied: false,
      reaction: 'No quedó del todo claro, ¿me lo podría explicar de otra forma?',
      missing: question || 'responder la pregunta'
    }
  }

  const messages = [
    { role: 'system', content: student.systemPrompt(paper, slides) },
    { role: 'user', content: 'El profesor terminó su explicación.' }
  ]
  for (const h of turn) {
    messages.push({ role: 'assistant', content: h.question })
    if (h.answer) messages.push({ role: 'user', content: h.answer })
  }
  messages.push({
    role: 'user',
    content: verdict.passed
      ? 'La respuesta del profesor fue correcta y te quedó claro. Agradécele de forma natural en una frase corta (max 25 palabras). Solo la frase.'
      : `La respuesta del profesor todavía no te convence. Lo que falta: ${verdict.missing}. Díselo con amabilidad y curiosidad en una frase corta (max 25 palabras), sin revelar la respuesta. Solo la frase.`
  })
  let reaction
  try {
    reaction = (await llm.chat(messages) || '').trim()
  } catch {
    reaction = ''
  }
  return {
    satisfied: verdict.passed,
    reaction: reaction || (verdict.passed ? 'Gracias, quedó claro.' : 'Hmm, todavía tengo dudas.'),
    missing: verdict.missing
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

module.exports = { STUDENTS, generateTurn, evaluateAndReact, evaluateClarity, evaluatePresentation, isNonAnswer, generateReferenceAnswer, judgeAnswer }