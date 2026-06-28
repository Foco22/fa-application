import { state } from './state.js'
import { toast } from './toast.js'

export async function renderQuizSection(p) {
  const quizDiv = document.getElementById('pv-quiz')
  const btn     = document.getElementById('btn-quiz')

  if (p.quiz) {
    try {
      const data    = typeof p.quiz === 'string' ? JSON.parse(p.quiz) : p.quiz
      btn.textContent = '↺ Regenerar'
      btn.disabled    = false
      const results = await window.api.getQuizResults(p.id)
      if (results && results.length > 0) {
        const last = results[0]
        const prev = typeof last.answers === 'string' ? JSON.parse(last.answers) : last.answers
        renderQuizSubmitted(quizDiv, data.questions, prev, last.score, last.total, last.taken_at)
      } else {
        renderQuiz(quizDiv, data.questions)
      }
      return
    } catch (_) {}
  }
  quizDiv.innerHTML  = ''
  btn.textContent    = 'Generar'
  btn.disabled       = false
}

export function renderQuizSubmitted(container, questions, prevAnswers, score, total, takenAt) {
  container.innerHTML = ''
  const quizEl = document.createElement('div')
  quizEl.className = 'quiz'

  const date = takenAt ? new Date(takenAt).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
  const pct  = Math.round((score / total) * 100)
  const headerEl = document.createElement('div')
  headerEl.className = 'quiz-prev-header'
  headerEl.textContent = `Último intento${date ? ' — ' + date : ''}: ${score}/${total} (${pct}%)`
  quizEl.appendChild(headerEl)

  questions.forEach((q, qi) => {
    const block = document.createElement('div')
    block.className = 'quiz-question'

    const qText = document.createElement('div')
    qText.className   = 'question-text'
    qText.textContent = `${qi + 1}. ${q.question}`
    block.appendChild(qText)

    const opts = document.createElement('div')
    opts.className = 'options'
    const chosen = prevAnswers[qi] ?? prevAnswers[String(qi)]

    q.options.forEach((opt, oi) => {
      const label = document.createElement('label')
      label.className = 'option'
      if (oi === q.correct)        label.classList.add('correct')
      else if (oi === chosen)      label.classList.add('wrong')
      const text = document.createElement('span')
      text.textContent = opt
      label.appendChild(text)
      opts.appendChild(label)
    })
    block.appendChild(opts)

    if (q.explanation) {
      const exp = document.createElement('div')
      exp.className   = 'quiz-explanation'
      exp.textContent = q.explanation
      block.appendChild(exp)
    }
    quizEl.appendChild(block)
  })

  container.appendChild(quizEl)
}

export function renderQuiz(container, questions) {
  state.quizAnswers   = {}
  state.quizSubmitted = false
  container.innerHTML = ''

  const quizEl = document.createElement('div')
  quizEl.className = 'quiz'

  questions.forEach((q, qi) => {
    const block = document.createElement('div')
    block.className = 'quiz-question'

    const qText = document.createElement('div')
    qText.className  = 'question-text'
    qText.textContent = `${qi + 1}. ${q.question}`
    block.appendChild(qText)

    const opts = document.createElement('div')
    opts.className = 'options'

    q.options.forEach((opt, oi) => {
      const label = document.createElement('label')
      label.className = 'option'
      const radio = document.createElement('input')
      radio.type = 'radio'; radio.name = `q${qi}`; radio.value = oi
      radio.addEventListener('change', () => {
        state.quizAnswers[qi] = oi
        opts.querySelectorAll('.option').forEach((el, idx) => {
          el.classList.toggle('selected', idx === oi)
        })
      })
      const text = document.createElement('span')
      text.textContent = opt
      label.appendChild(radio); label.appendChild(text)
      opts.appendChild(label)
    })

    block.appendChild(opts)
    quizEl.appendChild(block)
  })

  const actions   = document.createElement('div')
  actions.className = 'quiz-actions'
  const submitBtn = document.createElement('button')
  submitBtn.className   = 'btn-primary'
  submitBtn.textContent = 'Enviar respuestas'
  submitBtn.addEventListener('click', () => submitQuiz(questions, quizEl))
  actions.appendChild(submitBtn)
  quizEl.appendChild(actions)
  container.appendChild(quizEl)
}

export async function submitQuiz(questions, quizEl) {
  if (state.quizSubmitted) return
  const answered = Object.keys(state.quizAnswers).length
  if (answered < questions.length) {
    toast(`Responde todas las preguntas (${answered}/${questions.length})`, 'error')
    return
  }

  state.quizSubmitted = true
  let correct = 0

  questions.forEach((q, qi) => {
    const block  = quizEl.querySelectorAll('.quiz-question')[qi]
    const opts   = block.querySelectorAll('.option')
    const chosen = state.quizAnswers[qi]
    if (chosen === q.correct) correct++

    opts.forEach((el, idx) => {
      el.classList.remove('selected')
      if (idx === q.correct)   el.classList.add('correct')
      else if (idx === chosen) el.classList.add('wrong')
    })

    if (q.explanation) {
      const exp = document.createElement('div')
      exp.className   = 'quiz-explanation'
      exp.textContent = q.explanation
      block.appendChild(exp)
    }
  })

  const pct = Math.round((correct / questions.length) * 100)
  const scoreEl = document.createElement('div')
  scoreEl.className = 'quiz-score'
  scoreEl.innerHTML = `
    <div class="score-number ${pct >= 60 ? 'score-pass' : 'score-fail'}">${correct}/${questions.length}</div>
    <div class="score-label">${pct}% — ${pct >= 80 ? '¡Excelente!' : pct >= 60 ? 'Bien' : 'Sigue practicando'}</div>
  `
  quizEl.querySelector('.quiz-actions')?.remove()
  quizEl.appendChild(scoreEl)

  await window.api.saveQuizResult({
    paper_id: state.activePaper.id, score: correct,
    total: questions.length, answers: JSON.stringify(state.quizAnswers),
  })
  toast(`Quiz guardado: ${correct}/${questions.length}`, pct >= 60 ? 'success' : 'info')
}

export async function generateQuiz() {
  if (!state.activePaper) return
  const btn     = document.getElementById('btn-quiz')
  const quizDiv = document.getElementById('pv-quiz')
  btn.disabled    = true
  btn.textContent = 'Generando…'
  quizDiv.innerHTML = ''

  try {
    const data  = await window.api.generateQuiz(state.activePaper.id)
    state.activePaper = await window.api.getPaper(state.activePaper.id)
    renderQuiz(quizDiv, data.questions)
    btn.textContent = '↺ Regenerar'
    toast('Quiz generado', 'success')
  } catch (err) {
    toast('Error al generar quiz: ' + err.message, 'error')
    btn.textContent = 'Generar'
  }
  btn.disabled = false
}
