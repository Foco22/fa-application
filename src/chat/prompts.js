function buildSystemPrompt(paper) {
  if (!paper) {
    return 'Eres un asistente de investigación científica. Responde en español de forma clara y concisa.'
  }

  const context = paper.pdf_text || paper.abstract || '(sin texto disponible)'

  return `Eres un asistente experto en investigación científica. El usuario está leyendo el siguiente paper y puede hacerte preguntas sobre él. Responde siempre en español, de forma clara y precisa, basándote en el contenido del paper.

PAPER: ${paper.title}
AUTORES: ${paper.authors}

CONTENIDO:
${context}`
}

module.exports = { buildSystemPrompt }
