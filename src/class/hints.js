const { parseJSONResponse } = require('../llm/prompts')

function formatExchanges(history) {
  return history
    .map(e => {
      const parts = []
      if (e.question) parts.push(`Estudiante: ${e.question}`)
      if (e.answer)   parts.push(`Profesor:   ${e.answer}`)
      return parts.join('\n')
    })
    .filter(Boolean)
    .join('\n\n')
}

async function findExcerpts({ paperText, question, history, missing }, llm) {
  try {
    const exchangeBlock = formatExchanges(history || [])
    const messages = [
      {
        role: 'system',
        content: `Eres un asistente que ayuda a identificar fragmentos relevantes en papers científicos.
Dado el texto de un paper, la pregunta de un estudiante y los intentos del profesor de responderla, selecciona entre 2 y 3 citas textuales CORTAS del paper que contengan la información necesaria para responder correctamente.
Las citas deben ser fragmentos exactos del texto (verbatim), no paráfrasis.
Responde ÚNICAMENTE con JSON: {"excerpts": ["cita 1", "cita 2", ...]}`
      },
      {
        role: 'user',
        content: `Pregunta del estudiante: ${question}
${exchangeBlock ? `\nIntercambio completo:\n${exchangeBlock}` : ''}
${missing ? `\nLo que falta o está incorrecto en la respuesta del profesor: ${missing}` : ''}

Texto del paper:
${paperText}

Encuentra los fragmentos exactos del paper que contienen la información que le falta al profesor para responder correctamente.`
      }
    ]
    const raw = await llm.chat(messages)
    const parsed = parseJSONResponse(raw)
    if (Array.isArray(parsed.excerpts)) return parsed.excerpts
    return []
  } catch {
    return []
  }
}

async function buildGuidance({ question, history, missing, excerpts }, llm) {
  try {
    const exchangeBlock = formatExchanges(history || [])
    const excerptBlock  = excerpts.map((e, i) => `${i + 1}. "${e}"`).join('\n')
    const messages = [
      {
        role: 'system',
        content: `Eres un tutor experto que ayuda a un profesor a entender un concepto del paper para que pueda responder una pregunta de su estudiante.

Tu orientación no debe ser una pregunta. Sé muy conciso — máximo 80 palabras. Organiza tu respuesta así (sin escribir los títulos):
- Una frase que sitúa el concepto en contexto
- 2-3 puntos clave con la lógica del paper (usa viñetas y **negritas** para términos importantes)
- Una frase final que oriente al profesor sobre qué destacar en su respuesta, sin revelarla

No hagas preguntas. No uses "¿Cómo crees...?", "¿Qué piensas...?".`
      },
      {
        role: 'user',
        content: `Pregunta del estudiante: ${question}
${exchangeBlock ? `\nIntercambio hasta ahora:\n${exchangeBlock}` : ''}
${missing ? `\nLo que falta en la respuesta del profesor: ${missing}` : ''}

Fragmentos del paper relevantes:
${excerptBlock}

Escribe la orientación estructurada (Introducción, Desarrollo, Conclusión) para que el profesor entienda el concepto y pueda responder con sus propias palabras.`
      }
    ]
    const result = await llm.chat(messages)
    return result.trim()
  } catch {
    return ''
  }
}

async function buildAnswer({ question, history, missing, excerpts }, llm) {
  try {
    const exchangeBlock = formatExchanges(history || [])
    const excerptBlock  = excerpts.map((e, i) => `${i + 1}. "${e}"`).join('\n')
    const messages = [
      {
        role: 'system',
        content: `Eres un experto en papers científicos. Sintetiza la respuesta correcta en formato conciso y visual: 3-4 puntos clave en viñetas, con **negritas** para los términos más importantes. Máximo 70 palabras. Contrasta con lo que el profesor dijo para aclarar errores. Sé directo y claro.`
      },
      {
        role: 'user',
        content: `Pregunta del estudiante: ${question}
${exchangeBlock ? `\nIntercambio completo:\n${exchangeBlock}` : ''}
${missing ? `\nLo que falta o está incorrecto: ${missing}` : ''}

Fragmentos del paper:
${excerptBlock}

Proporciona la respuesta completa y correcta que el profesor debería dar al estudiante, corrigiendo o completando lo que dijo.`
      }
    ]
    const result = await llm.chat(messages)
    return result.trim()
  } catch {
    return ''
  }
}

async function generateHint(student, { paper, history, exchangeCount, missing }, llm) {
  const paperText = paper.pdf_text || paper.abstract || ''
  const question  = history?.[0]?.question || ''

  const excerpts = await findExcerpts({ paperText, question, history, missing }, llm)

  if (exchangeCount === 1) {
    return { excerpts, guidance: null, answer: null }
  }

  if (exchangeCount === 2) {
    const guidance = await buildGuidance({ question, history, missing, excerpts }, llm)
    return { excerpts, guidance, answer: null }
  }

  // exchangeCount >= 3
  const answer = await buildAnswer({ question, history, missing, excerpts }, llm)
  return { excerpts, guidance: null, answer }
}

async function assistantChat({ question, missing, excerpts, history, canRevealAnswer }, llm) {
  const excerptBlock = (excerpts || []).map((e, i) => `${i + 1}. "${e}"`).join('\n')
  const messages = [
    {
      role: 'system',
      content: `Eres un asistente de enseñanza que ayuda a un profesor a prepararse para responder la pregunta de un estudiante.

Contexto:
- Pregunta del estudiante: ${question}
${missing ? `- Lo que falta en la respuesta del profesor: ${missing}` : ''}
${excerptBlock ? `\nFragmentos relevantes del paper:\n${excerptBlock}` : ''}

${canRevealAnswer
  ? 'El profesor ya tuvo suficientes intentos. AHORA SÍ debes revelar la respuesta completa y clara para que pueda transmitírsela al estudiante.'
  : `Responde de forma muy concisa: máximo 3 puntos clave en viñetas o 2-3 oraciones breves. Usa **negritas** para los términos importantes. Referencia los fragmentos del paper. No reveles la respuesta final directa. NUNCA termines con una pregunta al profesor. No uses "¿Te gustaría...?", "¿Quieres que...?", "¿Cómo crees...?".`}`,
    },
    ...(history || [])
  ]
  const result = await llm.chat(messages)
  return result.trim()
}

module.exports = { findExcerpts, buildGuidance, buildAnswer, generateHint, assistantChat }
