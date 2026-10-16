// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../renderer/modules/highlights.js', () => ({ loadSavedHighlights: vi.fn() }))

import { state } from '../../../renderer/modules/state.js'
import { renderPdfPage, setPdfScale } from '../../../renderer/modules/pdf.js'

function fakePage() {
  return {
    getViewport: ({ scale }) => ({ width: 100 * scale, height: 150 * scale }),
    render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
    getTextContent: async () => ({})
  }
}

beforeEach(() => {
  document.body.innerHTML = '<div id="pdf-viewer"></div><span id="pdf-zoom-level"></span>'
  HTMLCanvasElement.prototype.getContext = () => ({})
  globalThis.pdfjsLib = { renderTextLayer: () => ({ promise: Promise.resolve(), cancel: vi.fn() }) }
  state.pdfLoadId = 0
  state.pdfScale = 1.5
})

describe('renderPdfPage — carrera con el zoom', () => {
  it('no agrega la página si el loadId quedó obsoleto durante getPage', async () => {
    let resolvePage
    state.pdfDoc = { numPages: 1, getPage: () => new Promise(r => { resolvePage = r }) }
    const viewer = document.getElementById('pdf-viewer')

    const p = renderPdfPage(1, viewer, 1)
    state.pdfLoadId = 2            // el usuario hizo zoom: render obsoleto
    resolvePage(fakePage())
    await p

    expect(viewer.children.length).toBe(0)
  })

  it('agrega la página cuando el loadId sigue vigente', async () => {
    state.pdfLoadId = 1
    state.pdfDoc = { numPages: 1, getPage: async () => fakePage() }
    const viewer = document.getElementById('pdf-viewer')

    await renderPdfPage(1, viewer, 1)
    expect(viewer.children.length).toBe(1)
  })
})

describe('setPdfScale — zoom consecutivo', () => {
  it('dos zooms seguidos dejan una sola copia de cada página', async () => {
    state.pdfDoc = { numPages: 3, getPage: async () => fakePage() }
    const a = setPdfScale(2)
    const b = setPdfScale(2.5)
    await Promise.all([a, b])

    const viewer = document.getElementById('pdf-viewer')
    expect(viewer.children.length).toBe(3)
    expect(viewer.children[0].style.width).toBe('250px')
  })
})
