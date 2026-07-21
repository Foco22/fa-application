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

// Una fila `| a | b |` — el separador (`| --- | --- |`) es solo otra fila más
// para este chequeo; se descarta por posición (siempre la fila 1) al armar la tabla.
function isTableRow(line) {
  return /^\|.*\|$/.test(line)
}
function splitTableRow(line) {
  return line.slice(1, -1).split('|').map(c => c.trim())
}

export function renderMarkdown(text) {
  const lines = (text || '').split('\n')
  let html = ''
  let inUl = false, inOl = false, inCode = false, codeLang = '', codeLines = []
  let tableRows = []

  const closeList = () => {
    if (inUl) { html += '</ul>'; inUl = false }
    if (inOl) { html += '</ol>'; inOl = false }
  }
  const flushCode = () => {
    // El modelo a veces envuelve TODA su respuesta en un fence ```markdown en
    // vez de mandar el texto plano — no es código real, es su propio Markdown
    // de vuelta. Se reprocesa como markdown normal en lugar de mostrarlo como
    // un bloque de código gigante. Defensa en el render: cubre también
    // contenido guardado antes de que el orquestador empezara a sacar este
    // mismo fence en origen (src/ingestion/ocr.js).
    if (codeLang === 'markdown' || codeLang === 'md') {
      html += renderMarkdown(codeLines.join('\n'))
      codeLines = []; codeLang = ''
      return
    }
    const body     = escapeHtml(codeLines.join('\n'))
    const cls      = codeLang ? ` class="language-${escapeHtml(codeLang)}"` : ''
    const langSpan = codeLang ? `<span class="code-lang">${escapeHtml(codeLang)}</span>` : '<span></span>'
    html += `<div class="code-block"><div class="code-header">${langSpan}<button class="copy-btn">Copiar</button></div><pre><code${cls}>${body}</code></pre></div>`
    codeLines = []; codeLang = ''
  }
  // tableRows[0] = encabezado, tableRows[1] = fila separadora (se descarta),
  // el resto son filas del cuerpo — el orden lo garantiza la sintaxis Markdown.
  const flushTable = () => {
    if (!tableRows.length) return
    const header = splitTableRow(tableRows[0])
    html += `<table><thead><tr>${header.map(c => `<th>${mdInline(c)}</th>`).join('')}</tr></thead><tbody>`
    for (const row of tableRows.slice(2)) {
      const cells = splitTableRow(row)
      html += `<tr>${cells.map(c => `<td>${mdInline(c)}</td>`).join('')}</tr>`
    }
    html += '</tbody></table>'
    tableRows = []
  }

  for (const raw of lines) {
    if (/^```/.test(raw.trim())) {
      if (!inCode) {
        closeList()
        flushTable()
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

    if (isTableRow(line)) {
      closeList()
      tableRows.push(line)
      continue
    }
    if (tableRows.length) flushTable()

    if (!line) { closeList(); continue }

    // Comentario HTML de línea completa (ej. los marcadores <!-- page N ... -->
    // que el orquestador de OCR intercala entre páginas) — metadata interna, no
    // contenido del paper; un comentario HTML real tampoco se ve al renderizarse.
    if (/^<!--.*-->$/.test(line)) { closeList(); continue }

    if (/^-{3,}$/.test(line)) {
      closeList(); html += '<hr>'; continue
    } else if (/^#### /.test(line)) {
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
  flushTable()
  closeList()
  return html
}

