// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import katex from 'katex'

window.katex = katex

import {
  splitSlides, slideIndexAtOffset, slideOffset, highlightToMarkdown,
  textUnderQuads, renderSlideHtml, buildStarterDeck, mountSlide
} from '../../../renderer/modules/slides-md.js'

// ─── splitSlides ──────────────────────────────────────────────────────────────

describe('splitSlides', () => {
  it('splits slides on a line containing only ---', () => {
    expect(splitSlides('# A\ntexto\n---\n# B\n---\n# C')).toEqual(['# A\ntexto', '# B', '# C'])
  })

  it('accepts surrounding whitespace on the separator line', () => {
    expect(splitSlides('# A\n  ---  \n# B')).toEqual(['# A', '# B'])
  })

  it('drops empty slides (double separators, leading/trailing separators)', () => {
    expect(splitSlides('---\n# A\n---\n\n---\n# B\n---\n')).toEqual(['# A', '# B'])
  })

  it('does not split on --- inside a code fence', () => {
    expect(splitSlides('```\na\n---\nb\n```\n---\n# B')).toEqual(['```\na\n---\nb\n```', '# B'])
  })

  it('does not split on --- inside a $$ math block', () => {
    expect(splitSlides('$$\nx\n---\n$$\n---\n# B')).toEqual(['$$\nx\n---\n$$', '# B'])
  })

  it('returns [] for empty or blank input', () => {
    expect(splitSlides('')).toEqual([])
    expect(splitSlides('   \n\n')).toEqual([])
    expect(splitSlides(null)).toEqual([])
  })

  it('handles CRLF line endings', () => {
    expect(splitSlides('# A\r\n---\r\n# B')).toEqual(['# A', '# B'])
  })
})

// ─── slideIndexAtOffset ───────────────────────────────────────────────────────

describe('slideIndexAtOffset', () => {
  const md = '# A\n---\n# B\n---\n# C'

  it('maps a cursor offset to the slide it is in', () => {
    expect(slideIndexAtOffset(md, 0)).toBe(0)
    expect(slideIndexAtOffset(md, md.indexOf('# B') + 1)).toBe(1)
    expect(slideIndexAtOffset(md, md.length)).toBe(2)
  })

  it('ignores empty slides so it matches splitSlides indices', () => {
    const withEmpty = '# A\n---\n\n---\n# B'
    expect(slideIndexAtOffset(withEmpty, withEmpty.indexOf('# B'))).toBe(1)
  })

  it('clamps to the last real slide when the cursor sits in trailing empty space', () => {
    const trailing = '# A\n---\n# B\n---\n'
    expect(slideIndexAtOffset(trailing, trailing.length)).toBe(1)
  })

  it('returns 0 for an empty document', () => {
    expect(slideIndexAtOffset('', 0)).toBe(0)
  })
})

// ─── slideOffset ──────────────────────────────────────────────────────────────

describe('slideOffset', () => {
  it('returns the offset where slide N starts (for jumping the cursor there)', () => {
    const md = '# A\n---\n# B\n---\n# C'
    expect(slideOffset(md, 0)).toBe(0)
    expect(md.slice(slideOffset(md, 1)).startsWith('# B')).toBe(true)
    expect(md.slice(slideOffset(md, 2)).startsWith('# C')).toBe(true)
  })

  it('round-trips with slideIndexAtOffset', () => {
    const md = '# A\nx\n---\n\n# B\n---\n# C'
    for (let i = 0; i < 3; i++) expect(slideIndexAtOffset(md, slideOffset(md, i))).toBe(i)
  })
})

// ─── highlightToMarkdown ──────────────────────────────────────────────────────

describe('highlightToMarkdown', () => {
  it('turns a highlight into a quoted line, flattening its line breaks', () => {
    expect(highlightToMarkdown({ text: 'self-attention\n  is all\nyou need' }))
      .toBe('> "self-attention is all you need"')
  })

  it('appends the comment as an attribution line when present', () => {
    expect(highlightToMarkdown({ text: 'x', comment: 'clave\npara intro' }))
      .toBe('> "x"\n> — clave para intro')
  })
})

// ─── textUnderQuads ───────────────────────────────────────────────────────────

// pdf.js text item: transform[4] = x, transform[5] = baseline y (PDF space, y up)
const item = (str, x, y, width, height = 10) => ({ str, transform: [1, 0, 0, 1, x, y], width, height })
// pdf.js normalised quad: [{x:minX,y:maxY},{x:maxX,y:maxY},{x:minX,y:minY},{x:maxX,y:minY}]
const quad = (minX, minY, maxX, maxY) => [
  { x: minX, y: maxY }, { x: maxX, y: maxY }, { x: minX, y: minY }, { x: maxX, y: minY }
]

describe('textUnderQuads', () => {
  it('returns the text of items covered by a highlight quad', () => {
    const items = [item('Hello world', 100, 700, 110), item('Other line', 100, 600, 100)]
    expect(textUnderQuads(items, [quad(98, 698, 212, 712)])).toBe('Hello world')
  })

  it('trims a partially covered item proportionally by characters', () => {
    // 10 chars over 100pt → 10pt each; quad covers x 150..200 → "56789"
    const items = [item('0123456789', 100, 700, 100)]
    expect(textUnderQuads(items, [quad(150, 698, 200, 712)])).toBe('56789')
  })

  it('joins multiple quads (multi-line highlight) in reading order with spaces', () => {
    const items = [item('first line', 100, 700, 100), item('second line', 100, 688, 110)]
    const quads = [quad(98, 698, 202, 712), quad(98, 686, 212, 700)]
    expect(textUnderQuads(items, quads)).toBe('first line second line')
  })

  it('returns "" when nothing is under the quads', () => {
    expect(textUnderQuads([item('x', 0, 0, 5)], [quad(500, 500, 600, 600)])).toBe('')
  })

  it('ignores empty items and tolerates missing inputs', () => {
    expect(textUnderQuads([item('', 100, 700, 0)], [quad(98, 698, 212, 712)])).toBe('')
    expect(textUnderQuads(null, null)).toBe('')
  })
})

// ─── renderSlideHtml ──────────────────────────────────────────────────────────

describe('renderSlideHtml', () => {
  it('renders headings, lists and inline math', () => {
    const html = renderSlideHtml('# Título\n- uno\n- $x^2$')
    expect(html).toContain('<h1>Título</h1>')
    expect(html).toContain('<li>uno</li>')
    expect(html).toContain('katex')
  })

  it('renders > as a real visible blockquote, not the collapsed figure <details>', () => {
    const html = renderSlideHtml('> "cita del paper"')
    expect(html).toContain('<blockquote>')
    expect(html).not.toContain('<details>')
    expect(html).toContain('cita del paper')
  })

  it('escapes raw HTML', () => {
    expect(renderSlideHtml('<script>alert(1)</script>')).not.toContain('<script>')
  })
})

// ─── buildStarterDeck ─────────────────────────────────────────────────────────

describe('buildStarterDeck', () => {
  it('produces an intro / desarrollo / conclusión deck titled with the paper', () => {
    const md = buildStarterDeck({ title: 'Attention Is All You Need' })
    const slides = splitSlides(md)
    expect(slides).toHaveLength(3)
    expect(slides[0]).toContain('Attention Is All You Need')
  })

  it('works without a paper title', () => {
    expect(splitSlides(buildStarterDeck(null))).toHaveLength(3)
  })
})

// ─── mountSlide ───────────────────────────────────────────────────────────────

describe('mountSlide', () => {
  it('renders the slide inside the 16:9 frame', () => {
    const el = document.createElement('div')
    mountSlide(el, '# Hola')
    expect(el.querySelector('.md-slide-frame .md-slide h1').textContent).toBe('Hola')
  })

  // La CSP de la app (style-src sin unsafe-inline) ignora los style="" que
  // vienen en HTML; KaTeX los usa para subíndices, raíces, etc. Reaplicarlos
  // por CSSOM (el.style) sí está permitido.
  it('re-applies inline style attributes through the CSSOM (KaTeX under CSP)', () => {
    const el = document.createElement('div')
    mountSlide(el, '$\\sqrt{d}$')
    const styled = [...el.querySelectorAll('[style]')]
    expect(styled.length).toBeGreaterThan(0)
    for (const node of styled) {
      expect(node.style.cssText).not.toBe('')
    }
  })
})
