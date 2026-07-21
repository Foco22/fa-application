// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import katex from 'katex'

// El script clásico <script src="node_modules/katex/dist/katex.min.js"> del
// index.html real deja esto mismo en window — acá lo simulamos con el paquete
// de Node, que expone la misma API (renderToString no necesita DOM).
window.katex = katex

import { parseSummary, renderMarkdown } from '../../../renderer/summary-utils.js'

// Simulates exactly what DeepSeek returns for "Attention Is All You Need"
const DEEPSEEK_CLEAN_JSON = JSON.stringify({
  "1": "El problema es que los modelos de traducción automática dependían de redes recurrentes (RNN/LSTM) o convolucionales (CNN) que procesan la información de forma secuencial. Las RNN procesan token por token, lo que impide la paralelización y las hace lentas con secuencias largas. Las CNN permiten paralelismo pero necesitan muchas capas para conectar palabras distantes. Esto limitaba la velocidad de entrenamiento y la capacidad de capturar dependencias de largo alcance, haciendo que los mejores modelos fueran muy costosos computacionalmente.",
  "2": "Se puede prescindir por completo de las redes recurrentes y convolucionales usando únicamente mecanismos de atención (self-attention) para modelar relaciones entre todas las palabras a la vez. El truco fundamental es que la atención permite que cada palabra 'mire' directamente a cualquier otra en un solo paso paralelo, sin importar la distancia entre ellas.",
  "3": "El Transformer tiene arquitectura codificador-decodificador. El codificador apila 6 capas idénticas con dos subcapas: self-attention (cada palabra mira a todas las demás) y una red feed-forward simple. El decodificador también tiene 6 capas pero añade una tercera subcapa de atención que mira la salida del codificador. Para preservar el orden de las palabras se añaden codificaciones posicionales. Todo se calcula en paralelo mediante multi-head attention que permite al modelo enfocarse en distintos aspectos simultáneamente.",
  "4": "Superó el estado del arte en traducción inglés-alemán con 28.4 BLEU (más de 2 puntos sobre el mejor modelo previo) e inglés-francés con 41.8 BLEU. Se entrenó en 3.5 días con 8 GPUs, una fracción del coste de modelos anteriores. También funcionó en análisis sintáctico superando modelos previos con pocos datos de entrenamiento.",
  "5": "La complejidad de la self-attention es O(n²·d) con la longitud de la secuencia, lo que lo hace costoso para secuencias muy largas. Asume que la atención captura todas las relaciones relevantes, lo que puede no ser óptimo para tareas con procesamiento estrictamente local o jerárquico. Queda abierto aplicarlo a otras modalidades (imágenes, audio, video) y reducir la generación autorregresiva del decodificador.",
})

// DeepSeek sometimes adds preamble before the JSON
const DEEPSEEK_WITH_PREAMBLE = `Aquí está el análisis del paper en formato JSON:\n\n${DEEPSEEK_CLEAN_JSON}`

// DeepSeek sometimes wraps in a markdown code fence
const DEEPSEEK_WITH_FENCE = `\`\`\`json\n${DEEPSEEK_CLEAN_JSON}\n\`\`\``

// DeepSeek-reasoner can add explanation after the JSON
const DEEPSEEK_WITH_SUFFIX = `${DEEPSEEK_CLEAN_JSON}\n\nEspero que este análisis sea útil.`

// Worst case: preamble + fence + suffix
const DEEPSEEK_WORST_CASE = `Análisis del paper:\n\`\`\`json\n${DEEPSEEK_CLEAN_JSON}\n\`\`\`\nFin del análisis.`

// ─── parseSummary ─────────────────────────────────────────────────────────────

describe('parseSummary — JSON format (DeepSeek output)', () => {
  it('parses clean JSON correctly', () => {
    const sections = parseSummary(DEEPSEEK_CLEAN_JSON)
    expect(sections).toHaveLength(5)
    expect(sections[0]).toContain('RNN')
    expect(sections[1]).toContain('self-attention')
    expect(sections[2]).toContain('codificador')
    expect(sections[3]).toContain('BLEU')
    expect(sections[4]).toContain('O(n²')
  })

  it('extracts JSON even with preamble text before it', () => {
    const sections = parseSummary(DEEPSEEK_WITH_PREAMBLE)
    expect(sections[0]).toContain('RNN')
    expect(sections[3]).toContain('BLEU')
  })

  it('extracts JSON even inside markdown code fence', () => {
    const sections = parseSummary(DEEPSEEK_WITH_FENCE)
    expect(sections[0]).toContain('RNN')
    expect(sections[4]).toContain('O(n²')
  })

  it('extracts JSON even with suffix text after it', () => {
    const sections = parseSummary(DEEPSEEK_WITH_SUFFIX)
    expect(sections[1]).toContain('self-attention')
    expect(sections[4]).toContain('O(n²')
  })

  it('extracts JSON in worst case (preamble + fence + suffix)', () => {
    const sections = parseSummary(DEEPSEEK_WORST_CASE)
    expect(sections[0]).toContain('RNN')
    expect(sections[4]).toContain('O(n²')
  })

  it('no section is empty', () => {
    const sections = parseSummary(DEEPSEEK_CLEAN_JSON)
    sections.forEach((s, i) => {
      expect(s.length, `section ${i + 1} is empty`).toBeGreaterThan(0)
    })
  })

  it('each section contains its expected keywords', () => {
    const [s1, s2, s3, s4, s5] = parseSummary(DEEPSEEK_CLEAN_JSON)
    expect(s1).toContain('secuencial')
    expect(s2).toContain('truco')
    expect(s3).toContain('codificador-decodificador')
    expect(s4).toContain('3.5 días')
    expect(s5).toContain('costoso')
  })

  it('preserves full text length — no truncation', () => {
    const sections = parseSummary(DEEPSEEK_CLEAN_JSON)
    const totalChars = sections.reduce((acc, s) => acc + s.length, 0)
    // Each section should be substantial — not truncated
    sections.forEach((s, i) => {
      expect(s.length, `section ${i + 1} seems truncated (${s.length} chars)`).toBeGreaterThan(100)
    })
    expect(totalChars).toBeGreaterThan(1000)
  })
})

// ─── renderMarkdown ───────────────────────────────────────────────────────────

describe('renderMarkdown — what the card actually shows', () => {
  it('wraps plain text in a <p> tag', () => {
    const html = renderMarkdown('Hello world')
    expect(html).toBe('<p>Hello world</p>')
  })

  it('renders **bold** as <strong>', () => {
    const html = renderMarkdown('**Transformer** es el modelo')
    expect(html).toContain('<strong>Transformer</strong>')
  })

  it('renders - list items as <ul><li>', () => {
    const html = renderMarkdown('- item uno\n- item dos')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>item uno</li>')
    expect(html).toContain('<li>item dos</li>')
  })

  it('renders the full section 5 text without truncation', () => {
    const [,,,, s5] = parseSummary(DEEPSEEK_CLEAN_JSON)
    const html = renderMarkdown(s5)
    expect(html).toContain('O(n²')
    expect(html).toContain('costoso')
    expect(html).toContain('modalidades')
    expect(html.length).toBeGreaterThan(s5.length * 0.8)
  })

  it('escapes < and > in text to avoid breaking HTML', () => {
    const html = renderMarkdown('complexity is O(n<sup>2</sup>)')
    expect(html).toContain('&lt;sup&gt;')
    expect(html).not.toContain('<sup>')
  })

  // El OCR transcribe tablas del paper a sintaxis Markdown (§4 del PRD) — si el
  // renderer no las soporta, la tabla queda como una línea con pipes sueltos.
  it('renders a markdown table as <table><thead>/<tbody>', () => {
    const html = renderMarkdown('| Modelo | BLEU |\n| --- | --- |\n| Transformer | 28.4 |\n| ConvS2S | 25.2 |')
    expect(html).toContain('<table>')
    expect(html).toContain('<thead><tr><th>Modelo</th><th>BLEU</th></tr></thead>')
    expect(html).toContain('<tbody>')
    expect(html).toContain('<tr><td>Transformer</td><td>28.4</td></tr>')
    expect(html).toContain('<tr><td>ConvS2S</td><td>25.2</td></tr>')
    expect(html).toContain('</table>')
  })

  it('renders inline formatting inside table cells', () => {
    const html = renderMarkdown('| Modelo | Nota |\n| --- | --- |\n| **Transformer** | usa `attention` |')
    expect(html).toContain('<td><strong>Transformer</strong></td>')
    expect(html).toContain('<td>usa <code>attention</code></td>')
  })

  it('ends the table and resumes normal paragraphs once the pipe rows stop', () => {
    const html = renderMarkdown('| A | B |\n| --- | --- |\n| 1 | 2 |\n\nTexto después de la tabla.')
    expect(html).toContain('</table>')
    expect(html).toContain('<p>Texto después de la tabla.</p>')
    expect(html.indexOf('</table>')).toBeLessThan(html.indexOf('<p>Texto después'))
  })

  it('renders a standalone --- line as <hr>, not a table or paragraph', () => {
    const html = renderMarkdown('Antes.\n\n---\n\nDespués.')
    expect(html).toContain('<hr>')
    expect(html).not.toContain('<p>---</p>')
  })

  // El orquestador de OCR intercala marcadores <!-- page N · source: ocr --> entre
  // páginas (src/ingestion/ocr.js) — son metadata interna, no contenido del paper,
  // y un comentario HTML real no se ve al renderizarse.
  it('hides a full-line HTML comment instead of showing it as text', () => {
    const html = renderMarkdown('Antes.\n\n<!-- page 1 · source: ocr -->\n\nDespués.')
    expect(html).not.toContain('page 1')
    expect(html).not.toContain('&lt;!--')
    expect(html).toBe('<p>Antes.</p><p>Después.</p>')
  })

  // Defensa en el render: contenido YA guardado en la DB antes de que el
  // orquestador empezara a sacar el fence en origen (src/ingestion/ocr.js)
  // sigue teniendo el ```markdown envolvente — esto lo hace verse bien igual,
  // sin depender de volver a pagar por una transcripción.
  it('treats a ```markdown fenced block as real markdown, not a code block', () => {
    const html = renderMarkdown('```markdown\n# Título\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n```')
    expect(html).toContain('<h1>Título</h1>')
    expect(html).toContain('<table>')
    expect(html).not.toContain('<pre>')
    expect(html).not.toContain('code-block')
  })

  it('still renders a real code block for any other language tag', () => {
    const html = renderMarkdown('```python\nprint(1)\n```')
    expect(html).toContain('<pre>')
    expect(html).toContain('print(1)')
  })

  // El orquestador de OCR envuelve la interpretación de figuras en un fence
  // ```figure (src/ingestion/ocr.js) — es contexto extra, no el texto de la
  // página, así que arranca colapsado como un <details> nativo, no un bloque
  // siempre visible.
  it('renders a ```figure fence as a collapsed <details>, not a code block or blockquote', () => {
    const html = renderMarkdown('```figure\nLa figura muestra la arquitectura.\n```')
    expect(html).toContain('<details>')
    expect(html).toContain('<summary>')
    expect(html).not.toMatch(/<details[^>]*\sopen/)
    expect(html).not.toContain('<pre>')
    expect(html).not.toContain('<blockquote>')
    expect(html).toContain('<p>La figura muestra la arquitectura.</p>')
    expect(html).toContain('</details>')
  })

  it('re-parses markdown nested inside a ```figure fence (headers, lists)', () => {
    const html = renderMarkdown('```figure\n### Descripción\n\n- item uno\n```')
    expect(html).toContain('<h3>Descripción</h3>')
    expect(html).toContain('<li>item uno</li>')
    expect(html).not.toContain('###')
  })

  // El OCR transcribe fórmulas a LaTeX ($...$ inline, $$...$$ display — §4 del
  // PRD). Antes se mostraban como texto crudo con \frac, \sqrt, etc. literales.
  describe('LaTeX (KaTeX real, no texto crudo)', () => {
    it('renders inline $...$ math with real KaTeX markup', () => {
      const html = renderMarkdown('El valor de $d_k$ es 64.')
      expect(html).toContain('class="katex"')
      expect(html).not.toContain('$d_k$')
      expect(html).not.toContain('&lt;span')
    })

    it('renders a multi-line $$ ... $$ display block (the shape the OCR prompt produces)', () => {
      const html = renderMarkdown('$$\n\\text{Attention}(Q, K, V) = \\text{softmax}\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)V\n$$')
      expect(html).toContain('katex-display')
      // KaTeX SÍ incluye el LaTeX original en la anotación MathML (accesibilidad,
      // copiar/pegar) — lo que no debe quedar es el bloque como texto plano sin
      // renderizar, envuelto en <p> con los "$$" literales.
      expect(html).not.toContain('<p>$$</p>')
      expect(html).not.toMatch(/<p>\\text\{Attention\}/)
    })

    it('renders a single-line $$...$$ display block', () => {
      const html = renderMarkdown('$$E = mc^2$$')
      expect(html).toContain('katex-display')
      expect(html).not.toContain('$$')
    })

    it('does not throw on stray/unpaired $ characters in ordinary text', () => {
      expect(() => renderMarkdown('Cuesta $5 y después $10, sin cerrar.')).not.toThrow()
    })

    it('resumes normal paragraphs after a display block ends', () => {
      const html = renderMarkdown('$$\nx^2\n$$\n\nTexto después.')
      expect(html).toContain('katex-display')
      expect(html).toContain('<p>Texto después.</p>')
    })
  })

  // El orquestador de OCR envolvía la interpretación de figuras en un bloque
  // `>` (formato viejo — ahora usa un fence ```figure, ver el describe de
  // arriba), y ese texto ya guardado en la DB de papers existentes sigue en
  // este formato. Se renderiza igual de colapsado que ```figure — el usuario
  // no debería tener que pagar de nuevo por OCR solo para que se vea bien.
  it('renders a blockquote as a collapsed <details>, not an always-visible blockquote', () => {
    const html = renderMarkdown('> Primera línea.\n> Segunda línea.')
    expect(html).toContain('<details>')
    expect(html).toContain('<summary>')
    expect(html).not.toMatch(/<details[^>]*\sopen/)
    expect(html).not.toContain('<blockquote>')
    expect(html).toContain('<p>Primera línea.</p><p>Segunda línea.</p>')
  })

  it('does not leak a bare ">" as its own paragraph on a blank line inside a quote', () => {
    // Así queda una línea en blanco dentro del texto citado una vez que
    // ocr.js le antepone "> " a cada línea (incluidas las vacías).
    const html = renderMarkdown('> Antes.\n>\n> Después.')
    expect(html).not.toContain('<p>&gt;</p>')
    expect(html).not.toContain('>&gt;<')
  })

  it('renders markdown nested inside a quoted block (headers, lists)', () => {
    const html = renderMarkdown('> ### Descripción\n>\n> - item uno\n> - item dos')
    expect(html).toContain('<details>')
    expect(html).toContain('<h3>Descripción</h3>')
    expect(html).toContain('<li>item uno</li>')
    expect(html).toContain('</details>')
    expect(html).not.toContain('###')
  })

  it('closes the quote block once a non-quote line appears', () => {
    const html = renderMarkdown('> Cita.\n\nTexto normal.')
    expect(html).toContain('<p>Cita.</p>')
    expect(html.endsWith('<p>Texto normal.</p>')).toBe(true)
  })
})
