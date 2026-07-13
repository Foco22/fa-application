// El idioma cambia SOLO el contenido que genera el LLM, nunca el esquema JSON:
// el parseo del resumen y del quiz depende de las mismas claves en ambos idiomas.
const LANGUAGES = {
  es: { in: 'en español', write: 'Escribe TODO el contenido en español.' },
  en: { in: 'in English', write: 'Write ALL the content in English.' },
}

function lang(language) {
  return LANGUAGES[language] || LANGUAGES.es
}

function buildSummaryPrompt(paper, language = 'es') {
  return `Título: ${paper.title}
Autores: ${paper.authors}

Abstract:
${paper.abstract}

Texto del paper:
${paper.pdf_text || '(no disponible)'}

---

Analiza este paper ${lang(language).in}. Escribe como un periodista científico explicando
a un colega inteligente que no leyó el paper: directo, fluido, concreto.
Evita el tono pasivo y burocrático. Empieza cada sección con una oración que
engancha, luego desarrolla con detalle (mínimo 4-6 oraciones por sección).

Sección 1 — El problema y por qué importa:
Arranca con la tensión: ¿qué no funcionaba y por qué era un problema real?
Contexto histórico, limitaciones de enfoques anteriores, y la razón por la que
este cuello de botella importaba más allá del paper.

Sección 2 — La idea clave:
El insight central en términos simples. ¿Qué cambio de perspectiva proponen?
Usa analogías si ayudan. El lector debe poder explicárselo a alguien más.

Sección 3 — Cómo funciona (en términos generales):
El mecanismo completo: componentes, cómo se conectan, cómo fluye la información.
Sin ecuaciones ni pseudocódigo, pero con suficiente detalle para dibujar el sistema.

Sección 4 — Qué tan bien funciona y qué evidencia hay:
Números concretos, benchmarks, comparaciones. ¿Cuánto mejor? ¿Bajo qué condiciones?
¿Qué significa ese resultado para el campo?

Sección 5 — Límites y qué queda abierto:
Supuestos que hacen, casos donde falla, críticas de la comunidad, y las preguntas
que este paper dejó abiertas para trabajo futuro.

Responde ÚNICAMENTE con un objeto JSON con exactamente estas 5 claves.
Sin markdown, sin texto adicional antes ni después del JSON.
El valor de cada clave es el análisis completo de esa sección, en texto plano.

{"1": "...", "2": "...", "3": "...", "4": "...", "5": "..."}

${lang(language).write}`
}

function buildQuizPrompt(paper, language = 'es') {
  return `Título: ${paper.title}
Autores: ${paper.authors}

Abstract:
${paper.abstract}

Texto del paper:
${paper.pdf_text || '(no disponible)'}

---

Genera exactamente 5 preguntas de opción múltiple ${lang(language).in} sobre este paper.
Cada pregunta tiene 4 alternativas (A, B, C, D). Una sola respuesta correcta.
Las preguntas deben evaluar comprensión profunda, no trivia.
Responde ÚNICAMENTE con un JSON con esta estructura:
{"questions": [{"question": "...", "options": ["A...", "B...", "C...", "D..."], "correct": 0, "explanation": "..."}]}

${lang(language).write}`
}

function buildAffiliationsPrompt(context) {
  return `Extract the institutional affiliation names from the lines below (taken from an academic paper's first page).

STRICT RULES:
- Include ONLY institution names that are LITERALLY written in the lines below
- Do NOT add any institution that is not explicitly present in the text
- Do NOT infer or guess based on the paper's topic or authors' names
- Do NOT include email addresses or author names, only institution names

Return ONLY a JSON array of strings. If none found, return [].

Lines:
${context}`
}

function buildMetadataPrompt(firstPageText) {
  return `Extract the title, authors list, and abstract from this academic paper's first page.
Return ONLY valid JSON: {"title": "...", "authors": "...", "abstract": "..."}
If a field is not found use an empty string. Authors as a comma-separated string.

Text:
${firstPageText.slice(0, 3000)}`
}

function buildAbstractSummaryPrompt(abstract) {
  return `Summarize the following paper abstract in 1-2 concise sentences, in English,
focused on the core topic and technique — not results, not filler. This summary is
used internally to match this paper against other research profiles, so keep it
dense with the actual subject matter.

Abstract:
${abstract}

Return ONLY the summary text. No preamble, no quotes, no markdown.`
}

function candidateAffiliationLines(text) {
  const keywords = [
    'university', 'institute', 'college', 'school of', 'department',
    'laboratory', 'polytechnic', 'faculty', 'research center', 'centre', 'research',
    'eth ', 'epfl', 'caltech', 'cnrs', 'inria', 'max planck',
  ]
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const hits = lines.filter(l => keywords.some(kw => l.toLowerCase().includes(kw)))
  return hits.length > 0 ? hits : lines
}

function parseJSONResponse(raw) {
  const cleaned = raw.trim()
    .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  return JSON.parse(cleaned)
}

module.exports = {
  buildSummaryPrompt,
  buildQuizPrompt,
  buildAffiliationsPrompt,
  buildMetadataPrompt,
  buildAbstractSummaryPrompt,
  candidateAffiliationLines,
  parseJSONResponse,
}
