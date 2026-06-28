function buildSlidesBlock(slides) {
  const interpreted = (slides || []).filter(s => s.interpretation)
  if (interpreted.length === 0) return ''
  const lines = interpreted.map(s =>
    `[Slide ${s.order_index + 1}${s.label ? ` — ${s.label}` : ''}]: ${s.interpretation}`
  )
  return `\nDiapositivas del profesor:\n${lines.join('\n')}`
}

function buildTurnInstruction(history) {
  if (!history || history.length === 0) {
    return 'Saluda al profesor con un "Hola profesor," amable y luego haz una sola pregunta sobre el paper. Sé específico, muestra que entendiste la explicación, y usa un tono cordial y curioso.'
  }
  return 'No quedaste completamente satisfecho. Responde con coherencia total a lo que el profesor dijo. Si su respuesta no tiene nada que ver con tu pregunta, señálalo con calma y rediríjelo. Si intentó responder pero fue vago, pide UNA aclaración concreta. Sé directo, cálido y natural.'
}

function buildHistoryBlock(history) {
  if (!history || history.length === 0) return ''
  const lines = history.flatMap(h => [`Tú: ${h.question}`, `Profesor: ${h.answer}`])
  return `\nIntercambio previo:\n${lines.join('\n')}`
}

function buildPreviousQABlock(previousQA) {
  if (!previousQA || previousQA.length === 0) return ''
  const lines = previousQA.map(qa => `${qa.studentName} preguntó: ${qa.question}`)
  return `\nPreguntas ya hechas por otros estudiantes:\n${lines.join('\n')}\nNo repitas temas ya cubiertos.`
}

function buildStudentSystemPrompt(student, paper, slides) {
  return `Eres ${student.name}, ${student.role}.
${student.trait}
Tienes acceso al siguiente paper:
Título: ${paper.title}
Abstract: ${paper.abstract || ''}
${buildSlidesBlock(slides)}
Texto del paper: ${(paper.pdf_text || '').slice(0, 8000)}`
}

module.exports = { buildSlidesBlock, buildTurnInstruction, buildHistoryBlock, buildPreviousQABlock, buildStudentSystemPrompt }
