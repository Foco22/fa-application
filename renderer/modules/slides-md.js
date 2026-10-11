// Slides de la Clase escritas en markdown dentro de la app.
// Un deck es un solo documento markdown; las slides se separan con una línea
// que contiene solo `---` (como Marp / reveal.js). Funciones puras — sin DOM —
// para que el editor, la preview y la presentación compartan la misma lógica.
import { renderMarkdown } from '../summary-utils.js'

const SEPARATOR_RE = /^-{3,}$/

// Trozos crudos entre separadores, con sus offsets en el texto original
// (los necesita el editor para saber en qué slide está el cursor). Un `---`
// dentro de un bloque de código o de un bloque $$ no separa slides.
function rawChunks(md) {
  const text = md || ''
  const chunks = []
  let start = 0, pos = 0, inCode = false, inMath = false
  for (const line of text.split('\n')) {
    const lineEnd = pos + line.length
    const trimmed = line.trim()
    if (/^```/.test(trimmed)) inCode = !inCode
    else if (!inCode && trimmed === '$$') inMath = !inMath
    else if (!inCode && !inMath && SEPARATOR_RE.test(trimmed)) {
      chunks.push({ start, end: pos })
      start = lineEnd + 1
    }
    pos = lineEnd + 1
  }
  chunks.push({ start, end: text.length })
  return chunks.map(c => {
    const raw = text.slice(c.start, Math.max(c.start, c.end))
    return { ...c, raw, text: raw.replace(/\r/g, '').trim() }
  })
}

export function splitSlides(md) {
  return rawChunks(md).filter(c => c.text).map(c => c.text)
}

// Índice (en splitSlides) de la slide donde está el cursor. Si el cursor cae en
// un trozo vacío, se queda en la slide real anterior.
export function slideIndexAtOffset(md, offset) {
  const chunks = rawChunks(md)
  const total  = chunks.filter(c => c.text).length
  if (total === 0) return 0
  let i = chunks.findIndex(c => offset <= c.end)
  if (i === -1) i = chunks.length - 1
  const before = chunks.slice(0, i).filter(c => c.text).length
  const idx = chunks[i].text ? before : before - 1
  return Math.max(0, Math.min(idx, total - 1))
}

// Offset donde empieza el contenido de la slide N (para mover el cursor ahí).
export function slideOffset(md, index) {
  const real = rawChunks(md).filter(c => c.text)
  const c = real[index]
  if (!c) return (md || '').length
  return c.start + (c.raw.length - c.raw.trimStart().length)
}

// Un destacado del PDF como cita lista para pegar en una slide.
export function highlightToMarkdown({ text, comment }) {
  const flat = (text || '').replace(/\s+/g, ' ').trim()
  const lines = [`> "${flat}"`]
  if (comment && comment.trim()) lines.push(`> — ${comment.replace(/\s+/g, ' ').trim()}`)
  return lines.join('\n')
}

// Texto que queda bajo las quadPoints de una anotación Highlight de un PDF
// (destacados hechos en otro lector: Acrobat, Zotero, Preview…). pdf.js da las
// quads ya normalizadas a 4 esquinas en espacio PDF (y hacia arriba) y los
// text items con transform[4]=x, transform[5]=línea base. Un item cubierto a
// medias se recorta proporcionalmente por caracteres — aproximado, pero los
// destacados casi siempre empiezan/terminan a mitad de un run de texto.
export function textUnderQuads(items, quads) {
  if (!items || !quads) return ''
  const pieces = []
  for (const q of quads) {
    const xs = q.map(p => p.x), ys = q.map(p => p.y)
    const minX = Math.min(...xs), maxX = Math.max(...xs)
    const minY = Math.min(...ys), maxY = Math.max(...ys)
    const hits = []
    for (const it of items) {
      if (!it.str || !it.width) continue
      const x  = it.transform[4]
      const h  = it.height || Math.abs(it.transform[3]) || 0
      const cy = it.transform[5] + h / 2
      if (cy < minY || cy > maxY) continue
      const ox1 = Math.max(x, minX), ox2 = Math.min(x + it.width, maxX)
      if (ox2 <= ox1) continue
      const n    = it.str.length
      const from = Math.round(((ox1 - x) / it.width) * n)
      const to   = Math.round(((ox2 - x) / it.width) * n)
      const part = it.str.slice(from, to)
      if (part.trim()) hits.push({ x, part })
    }
    hits.sort((a, b) => a.x - b.x)
    pieces.push(...hits.map(h => h.part))
  }
  return pieces.join(' ')
    .replace(/\s+/g, ' ')
    .replace(/(\w)- (\w)/g, '$1$2')   // palabra cortada con guion al final de línea
    .trim()
}

export function renderSlideHtml(md) {
  return renderMarkdown(md || '', { plainQuotes: true })
}

export function buildStarterDeck(paper) {
  const title = paper?.title || 'Mi clase'
  return [
    `# Introducción\n\n*${title}*\n\n- ¿Qué problema resuelve el paper?\n- ¿Por qué importa?`,
    `## Desarrollo\n\n- La idea clave\n- Cómo funciona\n- Un ejemplo concreto`,
    `## Conclusión\n\n- Resultados principales\n- Limitaciones y qué queda abierto`,
  ].join('\n\n---\n\n') + '\n'
}

export function slideFrameHtml(markdown) {
  return `<div class="md-slide-frame"><div class="md-slide">${renderSlideHtml(markdown)}</div></div>`
}

// Monta la slide en `container` (preview del editor y presentación usan esto,
// así lo que se ve al escribir es lo que se proyecta). La CSP de la app
// (style-src sin 'unsafe-inline') descarta los style="" que llegan por HTML, y
// KaTeX depende de ellos para subíndices, raíces y fracciones; reasignarlos por
// CSSOM (el.style.cssText) sí está permitido.
export function mountSlide(container, markdown) {
  container.innerHTML = slideFrameHtml(markdown)
  container.querySelectorAll('[style]').forEach(el => {
    el.style.cssText = el.getAttribute('style')
  })
}
