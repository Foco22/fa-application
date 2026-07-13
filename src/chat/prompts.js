// El idioma solo cambia en qué idioma responde el asistente; el contexto del
// paper (que está en inglés casi siempre) se pasa igual.
const LANGUAGES = {
  es: { name: 'español', reply: 'Responde siempre en español' },
  en: { name: 'English', reply: 'Always reply in English' },
}

function lang(language) {
  return LANGUAGES[language] || LANGUAGES.es
}

function buildSystemPrompt(paper, language = 'es') {
  const L = lang(language)

  if (!paper) {
    return `Eres un asistente de investigación científica. ${L.reply}, de forma clara y concisa.`
  }

  const context = paper.pdf_text || paper.abstract || '(sin texto disponible)'

  return `Eres un asistente experto en investigación científica. El usuario está leyendo el siguiente paper y puede hacerte preguntas sobre él. ${L.reply}, de forma clara y precisa, basándote en el contenido del paper.

PAPER: ${paper.title}
AUTORES: ${paper.authors}

CONTENIDO:
${context}`
}

module.exports = { buildSystemPrompt }
