export const SUMMARY_MARKERS = [
  '¿Cuál es el problema y por qué importa?',
  '¿Cuál es la idea clave?',
  '¿Cómo funciona, en términos generales?',
  '¿Qué tan bien funciona y qué evidencia hay?',
  '¿Cuáles son sus límites y qué queda abierto?',
]

export function parseSummary(text) {
  // Primary: JSON format {"1": "...", "2": "...", ...}
  try {
    const start = text.indexOf('{')
    const end   = text.lastIndexOf('}')
    if (start !== -1 && end > start) {
      const data = JSON.parse(text.slice(start, end + 1))
      if (data['1'] !== undefined) {
        return [1, 2, 3, 4, 5].map(i => (data[String(i)] || '').trim())
      }
    }
  } catch (_) {}

  // Fallback A: ===N=== separators
  const sepParts = text.split(/^===\d+===/m)
  if (sepParts.length >= 6) {
    return sepParts.slice(1, 6).map(s => s.trim())
  }

  // Fallback B: **N. title** or ### N. title headers
  const headerMatches = [...text.matchAll(/^(?:\*{1,2}|#{1,3}\s*)?\d+\.\s+[^\n]+$/gm)]
  if (headerMatches.length >= 5) {
    return Array.from({ length: 5 }, (_, i) => {
      const start = headerMatches[i].index + headerMatches[i][0].length
      const end   = i + 1 < headerMatches.length ? headerMatches[i + 1].index : text.length
      return text.slice(start, end).replace(/^[\s\-─—*]+/, '').trim()
    })
  }

  // Fallback C: known marker strings
  const sections = ['', '', '', '', '']
  let remaining = text
  for (let i = 0; i < SUMMARY_MARKERS.length; i++) {
    const escaped = SUMMARY_MARKERS[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`(?:\\*{0,2}\\d+\\.\\s*)?\\*{0,2}${escaped}\\*{0,2}`, 'i')
    const idx = remaining.search(re)
    if (idx === -1) continue
    const match = remaining.slice(idx).match(re)
    remaining = remaining.slice(idx + (match?.[0].length || 0))
    let end = remaining.length
    for (let j = i + 1; j < SUMMARY_MARKERS.length; j++) {
      const e2 = SUMMARY_MARKERS[j].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const next = remaining.search(new RegExp(`(?:\\*{0,2}\\d+\\.\\s*)?\\*{0,2}${e2}\\*{0,2}`, 'i'))
      if (next !== -1) { end = next; break }
    }
    sections[i] = remaining.slice(0, end).trim()
    remaining = remaining.slice(end)
  }
  return sections
}

export function mdInline(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>')
    .replace(/_(.+?)_/g,       '<em>$1</em>')
    .replace(/`(.+?)`/g,       '<code>$1</code>')
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function renderMarkdown(text) {
  const lines = (text || '').split('\n')
  let html = ''
  let inUl = false, inOl = false, inCode = false, codeLang = '', codeLines = []

  const closeList = () => {
    if (inUl) { html += '</ul>'; inUl = false }
    if (inOl) { html += '</ol>'; inOl = false }
  }
  const flushCode = () => {
    const body     = escapeHtml(codeLines.join('\n'))
    const cls      = codeLang ? ` class="language-${escapeHtml(codeLang)}"` : ''
    const langSpan = codeLang ? `<span class="code-lang">${escapeHtml(codeLang)}</span>` : '<span></span>'
    html += `<div class="code-block"><div class="code-header">${langSpan}<button class="copy-btn">Copiar</button></div><pre><code${cls}>${body}</code></pre></div>`
    codeLines = []; codeLang = ''
  }

  for (const raw of lines) {
    if (/^```/.test(raw.trim())) {
      if (!inCode) {
        closeList()
        inCode   = true
        codeLang = raw.trim().slice(3).trim()
      } else {
        inCode = false
        flushCode()
      }
      continue
    }

    if (inCode) { codeLines.push(raw); continue }

    const line = raw.trim()
    if (!line) { closeList(); continue }

    if (/^#### /.test(line)) {
      closeList(); html += `<h4>${mdInline(line.slice(5))}</h4>`
    } else if (/^### /.test(line)) {
      closeList(); html += `<h3>${mdInline(line.slice(4))}</h3>`
    } else if (/^## /.test(line)) {
      closeList(); html += `<h2>${mdInline(line.slice(3))}</h2>`
    } else if (/^# /.test(line)) {
      closeList(); html += `<h1>${mdInline(line.slice(2))}</h1>`
    } else if (/^> /.test(line)) {
      closeList(); html += `<blockquote>${mdInline(line.slice(2))}</blockquote>`
    } else if (/^[-*]\s+/.test(line)) {
      if (!inUl) { closeList(); html += '<ul>'; inUl = true }
      html += `<li>${mdInline(line.replace(/^[-*]\s+/, ''))}</li>`
    } else if (/^\d+\.\s+/.test(line)) {
      if (!inOl) { closeList(); html += '<ol>'; inOl = true }
      html += `<li>${mdInline(line.replace(/^\d+\.\s+/, ''))}</li>`
    } else {
      closeList()
      html += `<p>${mdInline(line)}</p>`
    }
  }
  if (inCode) flushCode()
  closeList()
  return html
}

